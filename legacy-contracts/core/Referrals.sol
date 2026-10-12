// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title Referrals — FHE-private referral system
/// @notice Referrers earn a percentage of platform fees WITHOUT their identity being
///         linked to the referred user on-chain. The referral relationship is stored
///         as an encrypted hash — nobody can see who referred whom.
/// @dev This is an FHE-NATIVE innovation. No other platform can do private referrals.
///      Fjord/Polymarket referrals are fully public. Ours are encrypted.
contract Referrals is FHEConstants {

    struct ReferralLink {
        address referrer;
        bytes32 codeHash;        // keccak256(referralCode) — public for lookup
        uint16 rewardBps;        // Referrer's share of platform fee (e.g., 1000 = 10%)
        euint64 encTotalEarned;  // ENCRYPTED — total referral earnings
        uint256 referralCount;   // How many used this code (public — social proof)
        bool active;
    }

    ISettlementVault public vault;

    mapping(bytes32 => ReferralLink) public links;       // codeHash → link
    mapping(address => bytes32) public referrerToCode;    // referrer → their codeHash
    mapping(address => bytes32) public userReferredBy;    // user → codeHash that referred them

    uint16 public constant DEFAULT_REWARD_BPS = 1000;    // 10% of platform fee
    uint16 public constant MAX_REWARD_BPS = 5000;        // 50% max

    error InvalidInput();
    error InvalidState();
    error Unauthorized();

    event ReferralLinkCreated(bytes32 indexed codeHash, address indexed referrer);
    event ReferralUsed(bytes32 indexed codeHash, address indexed user);
    event ReferralRewardPaid(bytes32 indexed codeHash);
    event ReferralDeactivated(bytes32 indexed codeHash);

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        _initFHEConstants();
    }

    /// @notice Create a referral link
    /// @param referralCode The referral code string (hashed on-chain for lookup)
    /// @param rewardBps Referrer's share of platform fees (basis points, max 50%)
    function createLink(string calldata referralCode, uint16 rewardBps) external {
        if (bytes(referralCode).length == 0) revert InvalidInput();
        if (rewardBps > MAX_REWARD_BPS) revert InvalidInput();
        if (rewardBps == 0) rewardBps = DEFAULT_REWARD_BPS;

        bytes32 codeHash = keccak256(abi.encodePacked(referralCode));
        if (links[codeHash].referrer != address(0)) revert InvalidState(); // code taken

        // Check referrer doesn't already have a code
        if (referrerToCode[msg.sender] != bytes32(0)) revert InvalidState();

        euint64 initEarned = FHE.asEuint64(0);
        FHE.allowThis(initEarned);
        FHE.allowSender(initEarned);

        links[codeHash] = ReferralLink({
            referrer: msg.sender,
            codeHash: codeHash,
            rewardBps: rewardBps,
            encTotalEarned: initEarned,
            referralCount: 0,
            active: true
        });

        referrerToCode[msg.sender] = codeHash;

        emit ReferralLinkCreated(codeHash, msg.sender);
    }

    /// @notice User registers they were referred by a code
    /// @dev Called once per user. Stores the relationship.
    function useReferralCode(string calldata referralCode) external {
        bytes32 codeHash = keccak256(abi.encodePacked(referralCode));

        ReferralLink storage link = links[codeHash];
        if (link.referrer == address(0)) revert InvalidInput();
        if (!link.active) revert InvalidState();
        if (link.referrer == msg.sender) revert InvalidInput(); // can't self-refer
        if (userReferredBy[msg.sender] != bytes32(0)) revert InvalidState(); // already referred

        userReferredBy[msg.sender] = codeHash;
        link.referralCount++;

        emit ReferralUsed(codeHash, msg.sender);
    }

    /// @notice Pay referral reward from platform fee (called by feature contracts)
    /// @param user The user who transacted (check if they have a referrer)
    /// @param token Payment token
    /// @param platformFee The total platform fee from this transaction
    /// @dev If user has a referrer, sends (fee × rewardBps / 10000) to referrer via vault.
    ///      Referrer earnings tracked as encrypted running total.
    function payReferralReward(
        address user,
        address token,
        uint64 platformFee
    ) external {
        bytes32 codeHash = userReferredBy[user];
        if (codeHash == bytes32(0)) return; // no referrer — skip

        ReferralLink storage link = links[codeHash];
        if (!link.active) return;

        uint64 reward = uint64((uint256(platformFee) * link.rewardBps) / 10000);
        if (reward == 0) return;

        // Update encrypted earnings
        euint64 encReward = FHE.asEuint64(reward);
        link.encTotalEarned = FHE.add(link.encTotalEarned, encReward);
        FHE.allowThis(link.encTotalEarned);
        FHE.allow(link.encTotalEarned, link.referrer);

        // Transfer reward from fee collector to referrer via vault
        FHE.allowThis(encReward);
        FHE.allowTransient(encReward, address(vault));
        FHE.allow(encReward, address(vault));
        vault.settleTrade(msg.sender, link.referrer, token, encReward);

        emit ReferralRewardPaid(codeHash);
    }

    /// @notice Deactivate referral link
    function deactivateLink() external {
        bytes32 codeHash = referrerToCode[msg.sender];
        if (codeHash == bytes32(0)) revert InvalidState();
        links[codeHash].active = false;
        emit ReferralDeactivated(codeHash);
    }

    // ─── Views ─────────────────────────────────────────────

    /// @notice Referrer views their encrypted earnings
    function getMyEarnings() external view returns (euint64) {
        bytes32 codeHash = referrerToCode[msg.sender];
        if (codeHash == bytes32(0)) revert InvalidState();
        return links[codeHash].encTotalEarned;
    }

    /// @notice Check if a user was referred
    function isReferred(address user) external view returns (bool) {
        return userReferredBy[user] != bytes32(0);
    }

    /// @notice Get referral code stats (public)
    function getLinkStats(bytes32 codeHash) external view returns (
        address referrer, uint16 rewardBps, uint256 referralCount, bool active
    ) {
        ReferralLink storage l = links[codeHash];
        return (l.referrer, l.rewardBps, l.referralCount, l.active);
    }

    /// @notice Get reward percentage for a referred user
    function getReferralRewardBps(address user) external view returns (uint16) {
        bytes32 codeHash = userReferredBy[user];
        if (codeHash == bytes32(0)) return 0;
        return links[codeHash].rewardBps;
    }
}
