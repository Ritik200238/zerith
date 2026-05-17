// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title ProofOfReserves — Publicly verifiable encrypted reserve threshold proofs
/// @notice A user (e.g. DAO treasurer) proves "I hold ≥ X tokens" without revealing
///         the exact balance. The encrypted balance lives in SettlementVault; this
///         contract computes FHE.gte against a plaintext threshold and exposes the
///         boolean outcome via Threshold Network verifiable reveal.
/// @dev Flow:
///      1. Prover calls vault.delegateBalanceRead(thisContract, token) once per token
///      2. Prover calls requestProof(token, threshold) — creates pending claim
///      3. Anyone calls revealProof(claimId, value, sig) with TN-signed result
///      Public observers see only: prover, token, threshold, outcome (≥ or <), timestamp.
///      The actual balance stays encrypted in the vault.
contract ProofOfReserves is FHEConstants {
    enum ClaimStatus { PENDING, VERIFIED_TRUE, VERIFIED_FALSE }

    struct Claim {
        address prover;
        address token;
        uint256 threshold;       // plaintext minimum claimed
        uint256 requestedAt;
        uint256 revealedAt;
        ClaimStatus status;
        euint64 encResult;       // 1 if balance >= threshold, else 0 (encrypted)
    }

    ISettlementVault public immutable vault;
    IPlatformRegistry public immutable registry;

    mapping(uint256 => Claim) public claims;
    mapping(address => uint256[]) private proverClaims;
    uint256 public nextClaimId;

    euint64 internal ONE_64;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    event ProofRequested(uint256 indexed claimId, address indexed prover, address indexed token, uint256 threshold);
    event ProofRevealed(uint256 indexed claimId, bool meetsThreshold);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);

        _initFHEConstants();
        ONE_64 = FHE.asEuint64(1);
        FHE.allowThis(ONE_64);
    }

    /// @notice Request a "balance ≥ threshold" proof for caller's vault holdings
    /// @dev Caller must have called vault.delegateBalanceRead(address(this), token) first
    /// @param token FHERC20 token to prove reserves of
    /// @param threshold Plaintext minimum amount being claimed
    /// @return claimId Identifier for the pending claim
    function requestProof(address token, uint256 threshold)
        external
        whenNotPaused
        returns (uint256 claimId)
    {
        if (token == address(0)) revert InvalidInput();
        if (threshold == 0) revert InvalidInput();
        if (threshold > type(uint64).max) revert InvalidInput();

        // Read prover's encrypted vault balance (requires prior delegateBalanceRead)
        euint64 balance = vault.getEncBalance(msg.sender, token);

        // Compute encrypted comparison: balance >= threshold
        euint64 thresholdEnc = FHE.asEuint64(uint64(threshold));
        ebool meets = FHE.gte(balance, thresholdEnc);

        // Convert ebool → euint64 (0 or 1) for verifiable reveal path
        euint64 encResult = FHE.select(meets, ONE_64, ZERO_64);

        // Allow contract to track + global for public reveal via Threshold Network
        FHE.allowThis(encResult);
        FHE.allowGlobal(encResult);

        claimId = nextClaimId++;
        claims[claimId] = Claim({
            prover: msg.sender,
            token: token,
            threshold: threshold,
            requestedAt: block.timestamp,
            revealedAt: 0,
            status: ClaimStatus.PENDING,
            encResult: encResult
        });
        proverClaims[msg.sender].push(claimId);

        emit ProofRequested(claimId, msg.sender, token, threshold);
    }

    /// @notice Publish the verified reveal of a claim's outcome
    /// @dev Anyone can call. Caller obtains (value, signature) off-chain via the
    ///      cofhe sdk: client.decryptForTx(handle).withoutPermit().execute().
    ///      FHE.publishDecryptResult validates the Threshold Network signature.
    /// @param claimId Pending claim to finalize
    /// @param resultValue 1 if balance ≥ threshold, 0 otherwise (TN-decrypted)
    /// @param signature Threshold Network signature attesting to the value
    function revealProof(
        uint256 claimId,
        uint64 resultValue,
        bytes calldata signature
    ) external whenNotPaused {
        Claim storage c = claims[claimId];
        if (c.prover == address(0)) revert InvalidInput();
        if (c.status != ClaimStatus.PENDING) revert InvalidState();
        if (resultValue > 1) revert InvalidInput();

        // On-chain TN signature verification
        FHE.publishDecryptResult(c.encResult, resultValue, signature);

        c.status = resultValue == 1 ? ClaimStatus.VERIFIED_TRUE : ClaimStatus.VERIFIED_FALSE;
        c.revealedAt = block.timestamp;

        emit ProofRevealed(claimId, resultValue == 1);
    }

    // ─── Views ─────────────────────────────────────────────

    function getClaim(uint256 claimId) external view returns (
        address prover,
        address token,
        uint256 threshold,
        uint256 requestedAt,
        uint256 revealedAt,
        ClaimStatus status
    ) {
        Claim storage c = claims[claimId];
        return (c.prover, c.token, c.threshold, c.requestedAt, c.revealedAt, c.status);
    }

    function getProverClaims(address prover) external view returns (uint256[] memory) {
        return proverClaims[prover];
    }

    function getProverClaimCount(address prover) external view returns (uint256) {
        return proverClaims[prover].length;
    }

    function getClaimCount() external view returns (uint256) {
        return nextClaimId;
    }

    /// @notice Convenience: latest verified-true threshold for (prover, token)
    /// @dev Returns 0 if no verified-true claim exists. Note: stale claims do
    ///      NOT auto-expire — caller should also check requestedAt for freshness.
    function getHighestVerifiedThreshold(address prover, address token)
        external
        view
        returns (uint256 highest)
    {
        uint256[] storage ids = proverClaims[prover];
        for (uint256 i = 0; i < ids.length; i++) {
            Claim storage c = claims[ids[i]];
            if (c.token == token && c.status == ClaimStatus.VERIFIED_TRUE && c.threshold > highest) {
                highest = c.threshold;
            }
        }
    }
}
