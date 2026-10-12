// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHERC20} from "../vendor/fherc20/FHERC20/FHERC20.sol";
import {FHE} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ConfidentialToken — FHERC20 (ERC-7984) test token with a public faucet
/// @notice Zerith's testnet tokens: CDEX (what bidders pay with) and MOCK (what the
///         demo sales sell) are both deployments of this contract.
/// @dev Balances are encrypted euint64 with 6 decimals. Testnet only.
contract ConfidentialToken is FHERC20 {
    /// @notice Faucet amount: 1,000 tokens (6 decimals)
    uint64 public constant FAUCET_AMOUNT = 1000 * 1e6;

    /// @notice One faucet claim per address per hour
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Supply minted to the deployer for seeding demo sales
    uint64 public constant INITIAL_SUPPLY = 1_000_000 * 1e6;

    /// @notice Last faucet claim per address
    mapping(address => uint256) public lastFaucetClaim;

    /// @notice Address allowed to mint for seeding
    address public admin;

    event FaucetClaimed(address indexed user, uint64 amount);

    error Unauthorized();
    error InvalidState();

    constructor(string memory name_, string memory symbol_)
        FHERC20(name_, symbol_, 6, "")
    {
        admin = msg.sender;
        _mint(msg.sender, FHE.asEuint64(INITIAL_SUPPLY));
    }

    /// @notice Public faucet — anyone can claim test tokens once per hour
    function faucet() external {
        if (block.timestamp < lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN) revert InvalidState();
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FHE.asEuint64(FAUCET_AMOUNT));
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Admin mint for seeding demo data
    function adminMint(address to, uint64 amount) external {
        if (msg.sender != admin) revert Unauthorized();
        _mint(to, FHE.asEuint64(amount));
    }
}
