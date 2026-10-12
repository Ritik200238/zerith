// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHERC20} from "../vendor/fherc20/FHERC20.sol";
import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ConfidentialToken — FHERC20 token for CipherDEX settlements
/// @notice All trading pairs on the platform use this token (or wrapped versions)
/// @dev Includes a rate-limited faucet for testnet demo usage
contract ConfidentialToken is FHERC20 {
    /// @notice Faucet amount: 1000 tokens (with 18 decimals, stored as uint64)
    /// @dev 1000 * 1e18 = 1e21 which fits in uint64 (max ~1.84e19).
    ///      So we use 1000 * 1e6 = 1e9 for a 6-decimal token to keep it safe.
    uint64 public constant FAUCET_AMOUNT = 1000 * 1e6;

    /// @notice Cooldown period between faucet claims
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Track last faucet claim per address
    mapping(address => uint256) public lastFaucetClaim;

    /// @notice Initial supply minted to deployer
    uint64 public constant INITIAL_SUPPLY = 1_000_000 * 1e6;

    /// @notice Admin address for access-controlled minting
    address public admin;

    event FaucetClaimed(address indexed user, uint64 amount);

    error Unauthorized();
    error InvalidState();

    constructor()
        FHERC20("CipherDEX Token", "CDEX", 6)
    {
        admin = msg.sender;
        // Mint initial supply to deployer for seeding demo data
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Public faucet — anyone can claim test tokens once per hour
    /// @dev Rate-limited to prevent abuse. For testnet/demo use only.
    function faucet() external {
        if (block.timestamp < lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN) revert InvalidState();
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Admin mint for pre-populating demo data
    /// @dev Gated behind admin access control
    function adminMint(address to, uint64 amount) external {
        if (msg.sender != admin) revert Unauthorized();
        _mint(to, amount);
    }
}
