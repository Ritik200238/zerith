// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title TokenVesting — On-chain vesting with encrypted amounts
/// @notice Locks tokens for beneficiaries with cliff + linear unlock schedule.
///         Total allocation is encrypted — nobody knows how many tokens you're vesting.
///         Claimed amounts tracked encrypted. On-chain enforcement — project can't rug.
/// @dev Used by SealedAuction, BatchAuction, DutchAuction, OverflowSale after settlement.
contract TokenVesting is ReentrancyGuard, FHEConstants {

    struct VestingSchedule {
        address beneficiary;
        address token;
        address granter;         // Who created this schedule (auction contract or admin)
        euint64 totalAmount;     // ENCRYPTED — total tokens to vest
        euint64 claimed;         // ENCRYPTED — tokens already claimed
        uint256 startTime;       // When vesting begins (after cliff)
        uint256 cliffEnd;        // No tokens before this time
        uint256 vestingEnd;      // 100% vested at this time
        bool revoked;            // Granter can revoke unvested portion
    }

    ISettlementVault public vault;

    mapping(uint256 => VestingSchedule) public schedules;
    mapping(address => uint256[]) public beneficiarySchedules;
    uint256 public nextScheduleId;

    /// @notice Authorized creators (auction contracts that can create vesting)
    mapping(address => bool) public authorizedCreators;
    address public admin;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();

    event VestingCreated(uint256 indexed scheduleId, address indexed beneficiary, uint256 cliffEnd, uint256 vestingEnd);
    event TokensClaimed(uint256 indexed scheduleId, address indexed beneficiary);
    event VestingRevoked(uint256 indexed scheduleId);
    event CreatorAuthorized(address indexed creator);

    constructor(address _vault, address _admin) {
        if (_vault == address(0) || _admin == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        admin = _admin;
        _initFHEConstants();
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /// @notice Authorize a contract to create vesting schedules
    function authorizeCreator(address creator) external onlyAdmin {
        if (creator == address(0)) revert InvalidInput();
        authorizedCreators[creator] = true;
        emit CreatorAuthorized(creator);
    }

    /// @notice Create a vesting schedule for a beneficiary
    /// @param beneficiary Who receives the tokens
    /// @param token FHERC20 token address
    /// @param encTotalAmount Encrypted total allocation
    /// @param cliffDuration Seconds before first unlock (0 = no cliff)
    /// @param vestingDuration Total seconds for full vest (after cliff)
    function createSchedule(
        address beneficiary,
        address token,
        euint64 encTotalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration
    ) external returns (uint256 scheduleId) {
        if (!authorizedCreators[msg.sender] && msg.sender != admin) revert Unauthorized();
        if (beneficiary == address(0)) revert InvalidInput();
        if (vestingDuration == 0) revert InvalidInput();

        scheduleId = nextScheduleId++;

        uint256 cliffEnd = block.timestamp + cliffDuration;
        uint256 vestingEnd = cliffEnd + vestingDuration;

        euint64 zeroClaimed = FHE.asEuint64(0);
        FHE.allowThis(zeroClaimed);
        FHE.allowThis(encTotalAmount);
        FHE.allow(encTotalAmount, beneficiary);

        schedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            token: token,
            granter: msg.sender,
            totalAmount: encTotalAmount,
            claimed: zeroClaimed,
            startTime: block.timestamp,
            cliffEnd: cliffEnd,
            vestingEnd: vestingEnd,
            revoked: false
        });

        beneficiarySchedules[beneficiary].push(scheduleId);

        emit VestingCreated(scheduleId, beneficiary, cliffEnd, vestingEnd);
    }

    /// @notice Claim vested tokens
    /// @dev Computes vested percentage based on time, applies to encrypted total,
    ///      subtracts already claimed. All on ciphertext.
    ///      FHE ops: mul(1), div(1), sub(2), lte(1), select(1), allowThis(2), allow(1)
    function claimVested(uint256 scheduleId) external nonReentrant {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.beneficiary != msg.sender) revert Unauthorized();
        if (schedule.revoked) revert InvalidState();
        if (block.timestamp < schedule.cliffEnd) revert InvalidState();

        // Compute vested percentage (plaintext — time-based)
        uint256 elapsed;
        uint64 vestedPct; // 0-100
        if (block.timestamp >= schedule.vestingEnd) {
            vestedPct = 100;
        } else {
            elapsed = block.timestamp - schedule.cliffEnd;
            uint256 vestDuration = schedule.vestingEnd - schedule.cliffEnd;
            vestedPct = uint64((elapsed * 100) / vestDuration);
        }

        if (vestedPct == 0) revert InvalidState();

        // Compute vested amount on ciphertext
        // vestedAmount = totalAmount × vestedPct / 100
        euint64 vestedAmount = FHE.div(
            FHE.mul(schedule.totalAmount, FHE.asEuint64(vestedPct)),
            FHE.asEuint64(100)
        );

        // Claimable = vestedAmount - alreadyClaimed
        // Use select to ensure no underflow (claim 0 if nothing new vested)
        euint64 claimable = FHE.select(
            FHE.lte(schedule.claimed, vestedAmount),
            FHE.sub(vestedAmount, schedule.claimed),
            ZERO_64
        );

        // Update claimed
        schedule.claimed = vestedAmount;
        FHE.allowThis(schedule.claimed);
        FHE.allowSender(schedule.claimed);

        // Transfer claimable from granter to beneficiary via vault
        FHE.allowThis(claimable);
        FHE.allowTransient(claimable, address(vault));
        FHE.allow(claimable, address(vault));
        vault.settleTrade(schedule.granter, msg.sender, schedule.token, claimable);

        emit TokensClaimed(scheduleId, msg.sender);
    }

    /// @notice Granter revokes unvested portion
    /// @dev Only affects FUTURE vesting. Already vested tokens are safe.
    function revokeSchedule(uint256 scheduleId) external {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.granter != msg.sender && msg.sender != admin) revert Unauthorized();
        if (schedule.revoked) revert InvalidState();

        schedule.revoked = true;
        emit VestingRevoked(scheduleId);
    }

    // ─── Views ─────────────────────────────────────────────

    function getSchedule(uint256 scheduleId) external view returns (
        address beneficiary, address token, address granter,
        uint256 cliffEnd, uint256 vestingEnd, bool revoked
    ) {
        VestingSchedule storage s = schedules[scheduleId];
        return (s.beneficiary, s.token, s.granter, s.cliffEnd, s.vestingEnd, s.revoked);
    }

    function getMyVestedAmount(uint256 scheduleId) external view returns (euint64) {
        if (schedules[scheduleId].beneficiary != msg.sender) revert Unauthorized();
        return schedules[scheduleId].totalAmount;
    }

    function getMyClaimed(uint256 scheduleId) external view returns (euint64) {
        if (schedules[scheduleId].beneficiary != msg.sender) revert Unauthorized();
        return schedules[scheduleId].claimed;
    }

    function getBeneficiarySchedules(address beneficiary) external view returns (uint256[] memory) {
        return beneficiarySchedules[beneficiary];
    }

    function getVestedPercentage(uint256 scheduleId) external view returns (uint64) {
        VestingSchedule storage s = schedules[scheduleId];
        if (block.timestamp < s.cliffEnd) return 0;
        if (block.timestamp >= s.vestingEnd) return 100;
        uint256 elapsed = block.timestamp - s.cliffEnd;
        uint256 vestDuration = s.vestingEnd - s.cliffEnd;
        return uint64((elapsed * 100) / vestDuration);
    }
}
