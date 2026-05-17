// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint8, euint64, InEuint8, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";

/// @title Reputation — Private trade reputation system
/// @notice After trades, both parties rate each other (encrypted 1-5 score).
///         Average computed on encrypted data. Only the rated user can see their own score.
/// @dev NON-BLOCKING: Feature contracts emit TradeCompleted events; Reputation reads them
///      via recordTrade(). If Reputation fails, all trading continues normally.
contract Reputation {
    IPlatformRegistry public registry;

    /// @notice Sum of all encrypted ratings received by a user
    mapping(address => euint64) private totalScores;

    /// @notice Track whether a user's totalScore handle has been initialized.
    ///         Audit fix C-REP1: prevents FHE ops on un-allocated zero handle.
    mapping(address => bool) private scoreInitialized;

    /// @notice Plaintext trade count (no privacy issue — visible from events anyway)
    mapping(address => uint256) public tradeCounts;

    /// @notice Prevents double-rating: keccak256(rater, rated, tradeId)
    mapping(bytes32 => bool) private hasRated;

    /// @notice Authorized callers (feature contracts that can record trades)
    mapping(address => bool) public authorizedCallers;

    /// @notice Recorded trades. Audit fix C-REP2: rater must have actually
    ///         traded with counterparty before submitting a rating.
    ///         Key: keccak256(partyA, partyB, tradeId) — set BIDIRECTIONALLY.
    mapping(bytes32 => bool) private tradeRecorded;

    /// @notice Cached average reputation (computed on-demand by user)
    mapping(address => euint64) private cachedReputation;

    /// @notice Admin address for managing authorized callers
    address public admin;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();

    // Pre-encrypted constants for rating validation
    euint8 private EUINT8_ONE;
    euint8 private EUINT8_FIVE;
    euint64 private EUINT64_ZERO;

    event TradeRecorded(address indexed partyA, address indexed partyB);
    event RatingSubmitted(address indexed rater, address indexed rated);
    event ReputationComputed(address indexed user, uint256 tradeCount);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyAuthorizedCaller() {
        if (!authorizedCallers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address _registry, address _admin) {
        if (_registry == address(0) || _admin == address(0)) revert InvalidInput();
        registry = IPlatformRegistry(_registry);
        admin = _admin;

        // Pre-encrypt constants
        EUINT8_ONE = FHE.asEuint8(1);
        EUINT8_FIVE = FHE.asEuint8(5);
        EUINT64_ZERO = FHE.asEuint64(0);
        FHE.allowThis(EUINT8_ONE);
        FHE.allowThis(EUINT8_FIVE);
        FHE.allowThis(EUINT64_ZERO);
    }

    /// @notice Record a completed trade between two parties for a specific tradeId
    /// @dev Called by feature contracts (OrderBook, Auction, Escrow, OTC) on every settled trade.
    ///      The tradeId scope ensures each settlement creates exactly one rate-able pair,
    ///      preventing rating spam.
    /// @dev Audit fix C-REP1: lazy-initializes encrypted score handles.
    /// @dev Audit fix C-REP2: persists the trade record so submitRating can verify it.
    function recordTrade(address partyA, address partyB, uint256 tradeId) external onlyAuthorizedCaller {
        if (partyA == partyB) revert InvalidInput();
        if (partyA == address(0) || partyB == address(0)) revert InvalidInput();

        // Lazy-init encrypted score handles so FHE.add doesn't fail on first rating
        if (!scoreInitialized[partyA]) {
            totalScores[partyA] = FHE.asEuint64(0);
            FHE.allowThis(totalScores[partyA]);
            FHE.allow(totalScores[partyA], partyA);
            scoreInitialized[partyA] = true;
        }
        if (!scoreInitialized[partyB]) {
            totalScores[partyB] = FHE.asEuint64(0);
            FHE.allowThis(totalScores[partyB]);
            FHE.allow(totalScores[partyB], partyB);
            scoreInitialized[partyB] = true;
        }

        // Mark trade as recorded for both directions so either party can rate the other
        bytes32 keyAB = keccak256(abi.encodePacked(partyA, partyB, tradeId));
        bytes32 keyBA = keccak256(abi.encodePacked(partyB, partyA, tradeId));
        tradeRecorded[keyAB] = true;
        tradeRecorded[keyBA] = true;

        tradeCounts[partyA]++;
        tradeCounts[partyB]++;
        emit TradeRecorded(partyA, partyB);
    }

    /// @notice Submit an encrypted rating for a trade counterparty
    /// @dev FHE ops: gte(1), lte(1), and(1), select(1), add(1) = 5 ops
    /// @dev Validates rating is 1-5 using encrypted comparison
    /// @param counterparty Address being rated
    /// @param encRating Encrypted rating (must be 1-5)
    /// @param tradeId Unique trade identifier (to prevent double-rating)
    function submitRating(
        address counterparty,
        InEuint8 calldata encRating,
        uint256 tradeId
    ) external {
        if (counterparty == msg.sender) revert InvalidInput();
        if (counterparty == address(0)) revert InvalidInput();

        // Audit fix C-REP2: must have actually traded with counterparty for this tradeId.
        // recordTrade was called by an authorized feature contract on settle.
        bytes32 tradeKey = keccak256(abi.encodePacked(msg.sender, counterparty, tradeId));
        if (!tradeRecorded[tradeKey]) revert Unauthorized();

        bytes32 ratingKey = tradeKey; // same shape; reused since each rater rates each tradeId once
        if (hasRated[ratingKey]) revert InvalidState();
        // Defense-in-depth: scoreInitialized is set in recordTrade, but assert anyway
        if (!scoreInitialized[counterparty]) revert InvalidState();

        euint8 rating = FHE.asEuint8(encRating);

        // Validate rating is in range [1, 5] using encrypted comparison
        ebool aboveMin = FHE.gte(rating, EUINT8_ONE);
        ebool belowMax = FHE.lte(rating, EUINT8_FIVE);
        ebool validRating = FHE.and(aboveMin, belowMax);

        // If invalid rating, use 0 (doesn't affect score). If valid, use the rating.
        euint8 validatedRating = FHE.select(validRating, rating, FHE.asEuint8(0));

        // Cast euint8 → euint64 for accumulation (uses FHE.asEuint64(euint8) overload)
        euint64 ratingAsU64 = FHE.asEuint64(validatedRating);
        FHE.allowThis(ratingAsU64);

        totalScores[counterparty] = FHE.add(totalScores[counterparty], ratingAsU64);
        FHE.allowThis(totalScores[counterparty]);
        FHE.allow(totalScores[counterparty], counterparty);

        hasRated[ratingKey] = true;
        emit RatingSubmitted(msg.sender, counterparty);
    }

    /// @notice Compute own average reputation
    /// @dev FHE ops: div(1, plaintext tradeCount) = 1 op
    /// @dev Only the user themselves can call this and unseal the result
    function computeMyReputation() external returns (euint64) {
        if (tradeCounts[msg.sender] == 0) revert InvalidState();

        // Division: trivially encrypt the plaintext count, then divide two encrypted values
        euint64 avgRep = FHE.div(totalScores[msg.sender], FHE.asEuint64(uint256(tradeCounts[msg.sender])));

        // ACL: contract stores, user can unseal
        FHE.allowThis(avgRep);
        FHE.allowSender(avgRep);

        cachedReputation[msg.sender] = avgRep;
        emit ReputationComputed(msg.sender, tradeCounts[msg.sender]);
        return avgRep;
    }

    /// @notice Read own reputation handle (for unsealing via cofhejs)
    function getMyReputation() external view returns (euint64) {
        return cachedReputation[msg.sender];
    }

    /// @notice Get plaintext trade count for any user
    function getTradeCount(address user) external view returns (uint256) {
        return tradeCounts[user];
    }

    // ─── Admin ──────────────────────────────────────────────

    function addAuthorizedCaller(address caller) external onlyAdmin {
        if (caller == address(0)) revert InvalidInput();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function removeAuthorizedCaller(address caller) external onlyAdmin {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }
}
