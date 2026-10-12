// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";

/// @title ProofOfReserves — Publicly verifiable encrypted reserve threshold proofs
/// @notice A user (e.g. DAO treasurer) proves "I hold ≥ X tokens" without revealing
///         the exact balance. The encrypted balance lives in SettlementVault; this
///         contract computes FHE.gte against a plaintext threshold and exposes the
///         boolean outcome via Threshold Network verifiable reveal.
/// @dev Flow:
///      1. Prover calls requestProof(token, threshold) — the vault compares the prover's
///         encrypted balance on ciphertext (this contract must be an authorized settler)
///      2. Anyone calls revealProof(claimId, value, sig) with the TN-signed result
///      Public observers see only: prover, token, threshold, outcome (≥ or <), timestamp.
///      The actual balance stays encrypted in the vault. A proof is a point-in-time
///      statement: the balance can change afterwards, so consumers should check
///      requestedAt (see getLatestVerifiedThreshold).
contract ProofOfReserves {
    enum ClaimStatus { PENDING, VERIFIED_TRUE, VERIFIED_FALSE }

    struct Claim {
        address prover;
        address token;
        uint256 threshold;       // plaintext minimum claimed
        uint256 requestedAt;
        uint256 revealedAt;
        ClaimStatus status;
        ebool encResult;         // balance >= threshold (encrypted until revealed)
    }

    ISettlementVault public immutable vault;
    IPlatformRegistry public immutable registry;

    mapping(uint256 => Claim) public claims;
    mapping(address => uint256[]) private proverClaims;
    uint256 public nextClaimId;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();
    error InvalidDecryptSignature();

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

    }

    /// @notice Request a "balance ≥ threshold" proof for caller's vault holdings
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

        // Encrypted comparison inside the vault: balance >= threshold.
        // Only ever for msg.sender, so nobody can probe someone else's balance.
        ebool meets = FHE.receiveEboolFromCall(
            vault.balanceAtLeast(msg.sender, token, uint64(threshold)),
            address(vault)
        );

        // Keep it, and make only this yes/no publicly decryptable.
        FHE.allowThis(meets);
        FHE.allowPublic(meets);

        claimId = nextClaimId++;
        claims[claimId] = Claim({
            prover: msg.sender,
            token: token,
            threshold: threshold,
            requestedAt: block.timestamp,
            revealedAt: 0,
            status: ClaimStatus.PENDING,
            encResult: meets
        });
        proverClaims[msg.sender].push(claimId);

        emit ProofRequested(claimId, msg.sender, token, threshold);
    }

    /// @notice Publish the verified reveal of a claim's outcome
    /// @dev Anyone can call. Caller obtains (value, signature) off-chain via the
    ///      cofhe sdk: client.decryptForTx(handle).withoutACP().execute(). The
    ///      signature is checked with FHE.verifyDecryptResult.
    /// @param claimId Pending claim to finalize
    /// @param meetsThreshold true if balance ≥ threshold (decrypted by Fhenix)
    /// @param signature Threshold Network signature attesting to the value
    function revealProof(
        uint256 claimId,
        bool meetsThreshold,
        bytes calldata signature
    ) external whenNotPaused {
        Claim storage c = claims[claimId];
        if (c.prover == address(0)) revert InvalidInput();
        if (c.status != ClaimStatus.PENDING) revert InvalidState();
        if (!FHE.verifyDecryptResult(c.encResult, meetsThreshold, signature)) revert InvalidDecryptSignature();

        c.status = meetsThreshold ? ClaimStatus.VERIFIED_TRUE : ClaimStatus.VERIFIED_FALSE;
        c.revealedAt = block.timestamp;

        emit ProofRevealed(claimId, meetsThreshold);
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

    /// @notice The most recent verified-true proof for (prover, token) and when it was
    ///         made. Returns (0, 0) if none. Freshness matters: a proof only says the
    ///         balance was at least `threshold` at `requestedAt`.
    function getLatestVerifiedThreshold(address prover, address token)
        external
        view
        returns (uint256 threshold, uint256 requestedAt)
    {
        uint256[] storage ids = proverClaims[prover];
        for (uint256 i = ids.length; i > 0; i--) {
            Claim storage c = claims[ids[i - 1]];
            if (c.token == token && c.status == ClaimStatus.VERIFIED_TRUE) {
                return (c.threshold, c.requestedAt);
            }
        }
    }
}
