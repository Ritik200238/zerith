// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title AllowlistGate — Merkle-based access control for auctions and sales
/// @notice Enables private launches, KYC-gated sales, NFT-holder access, and
///         whitelisted participation. Uses Merkle proofs for gas-efficient verification.
/// @dev Any feature contract can query isAllowed() before accepting bids/deposits.
///      Multiple allowlists supported (one per sale/auction).
contract AllowlistGate {

    struct Allowlist {
        bytes32 merkleRoot;
        address creator;
        bool active;
        string description;     // "KYC Verified", "NFT Holders", "VIP Round"
    }

    mapping(uint256 => Allowlist) public allowlists;
    mapping(uint256 => mapping(address => bool)) public hasClaimed; // prevent double-use
    uint256 public nextAllowlistId;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error NotAllowlisted();

    event AllowlistCreated(uint256 indexed allowlistId, address indexed creator, string description);
    event AllowlistUpdated(uint256 indexed allowlistId, bytes32 newRoot);
    event AllowlistDeactivated(uint256 indexed allowlistId);

    /// @notice Create a new allowlist with a Merkle root
    /// @param merkleRoot Root of Merkle tree containing allowed addresses
    /// @param description Human-readable label for the allowlist
    function createAllowlist(
        bytes32 merkleRoot,
        string calldata description
    ) external returns (uint256 allowlistId) {
        if (merkleRoot == bytes32(0)) revert InvalidInput();

        allowlistId = nextAllowlistId++;
        allowlists[allowlistId] = Allowlist({
            merkleRoot: merkleRoot,
            creator: msg.sender,
            active: true,
            description: description
        });

        emit AllowlistCreated(allowlistId, msg.sender, description);
    }

    /// @notice Update Merkle root (add/remove addresses off-chain, update root on-chain)
    function updateRoot(uint256 allowlistId, bytes32 newRoot) external {
        if (allowlists[allowlistId].creator != msg.sender) revert Unauthorized();
        if (!allowlists[allowlistId].active) revert InvalidState();
        if (newRoot == bytes32(0)) revert InvalidInput();

        allowlists[allowlistId].merkleRoot = newRoot;
        emit AllowlistUpdated(allowlistId, newRoot);
    }

    /// @notice Deactivate allowlist (makes it open to everyone)
    function deactivate(uint256 allowlistId) external {
        if (allowlists[allowlistId].creator != msg.sender) revert Unauthorized();
        allowlists[allowlistId].active = false;
        emit AllowlistDeactivated(allowlistId);
    }

    /// @notice Check if an address is in the allowlist
    /// @param allowlistId ID of the allowlist to check
    /// @param user Address to verify
    /// @param proof Merkle proof for the user
    /// @return True if user is in the allowlist (or allowlist is inactive = open to all)
    function isAllowed(
        uint256 allowlistId,
        address user,
        bytes32[] calldata proof
    ) external view returns (bool) {
        Allowlist storage al = allowlists[allowlistId];

        // Inactive allowlist = open to everyone
        if (!al.active) return true;

        bytes32 leaf = keccak256(abi.encodePacked(user));
        return MerkleProof.verify(proof, al.merkleRoot, leaf);
    }

    /// @notice Verify AND mark address as used (one-time gate)
    /// @dev For sales where each allowlisted address can only participate once
    function verifyAndMark(
        uint256 allowlistId,
        address user,
        bytes32[] calldata proof
    ) external returns (bool) {
        if (hasClaimed[allowlistId][user]) revert InvalidState();

        Allowlist storage al = allowlists[allowlistId];

        if (al.active) {
            bytes32 leaf = keccak256(abi.encodePacked(user));
            if (!MerkleProof.verify(proof, al.merkleRoot, leaf)) revert NotAllowlisted();
        }

        hasClaimed[allowlistId][user] = true;
        return true;
    }

    /// @notice Get allowlist details
    function getAllowlist(uint256 allowlistId) external view returns (
        bytes32 merkleRoot, address creator, bool active, string memory description
    ) {
        Allowlist storage al = allowlists[allowlistId];
        return (al.merkleRoot, al.creator, al.active, al.description);
    }

    function hasAllowlists() external view returns (bool) {
        return nextAllowlistId > 0;
    }
}
