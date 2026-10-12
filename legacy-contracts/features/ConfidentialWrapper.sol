// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ConfidentialWrapper — turn ANY ERC-20 into a confidential balance
/// @notice F2 from the Wave 4 plan. The killer composability move:
///         a single contract that wraps any ERC-20 token. Users deposit a
///         public ERC-20 amount and gain an encrypted balance inside the
///         wrapper. Inside, transfers are confidential (encrypted-amount,
///         no-leak transfers between users). To exit back to the public
///         ERC-20 world, users do a 2-step reveal-then-claim withdrawal.
///
/// @dev Privacy model:
///   - **deposit**: amount is public (you posted an ERC-20 transfer).
///     The internal encrypted balance grows by that amount.
///   - **transfer**: encrypted-amount, encrypted-balance. Zero-leak
///     between users. Uses FHE.select for zero-replacement on overdraft.
///   - **withdraw**: 2-step. requestWithdraw() opens the encrypted balance
///     for TN reveal; user fetches the value off-chain via decryptForView,
///     then calls executeWithdraw() with the revealed value + signature.
///     Contract verifies via publishDecryptResult and transfers the
///     requested amount up to the revealed balance.
///
/// Token amounts are stored as euint64. Tokens with >18 decimals or
/// supply >2^64 should use a wrapped sub-unit (e.g. wei → gwei).
contract ConfidentialWrapper is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice encBalance[token][user] — encrypted internal balance per (token, user)
    mapping(address => mapping(address => euint64)) public encBalance;

    /// @notice initialized[token][user] — was the FHE handle ever written?
    /// We need this because FHE.add of an uninitialized handle reverts.
    mapping(address => mapping(address => bool)) public initialized;

    /// @notice Total public deposits per token (stats only — does NOT
    /// reflect internal transfers). Used to bound total liability.
    mapping(address => uint256) public totalDeposited;

    // ─── Events ─────────────────────────────────────────────

    event Deposited(address indexed token, address indexed user, uint256 amount);
    event ConfidentialTransferred(address indexed token, address indexed from, address indexed to);
    event WithdrawRequested(address indexed token, address indexed user);
    event Withdrawn(address indexed token, address indexed user, uint256 amount);

    // ─── Errors ─────────────────────────────────────────────

    error InvalidInput();
    error AmountTooLarge();
    error InsufficientReveal();
    error NoBalance();

    // ─── Deposit (public → encrypted) ──────────────────────

    /// @notice Deposit a public amount of `token`. Internal encrypted
    ///         balance grows by exactly `amount`.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token == address(0) || amount == 0) revert InvalidInput();
        if (amount > type(uint64).max) revert AmountTooLarge();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited[token] += amount;

        euint64 inc = FHE.asEuint64(uint64(amount));
        FHE.allowThis(inc);

        if (initialized[token][msg.sender]) {
            euint64 newBal = FHE.add(encBalance[token][msg.sender], inc);
            FHE.allowThis(newBal);
            FHE.allow(newBal, msg.sender);
            encBalance[token][msg.sender] = newBal;
        } else {
            FHE.allow(inc, msg.sender);
            encBalance[token][msg.sender] = inc;
            initialized[token][msg.sender] = true;
        }

        emit Deposited(token, msg.sender, amount);
    }

    // ─── Transfer (encrypted → encrypted) ──────────────────

    /// @notice Confidential transfer between two users of the wrapped token.
    /// @dev Zero-replacement on overdraft: if sender has insufficient
    ///      balance, transfers 0. No revert (no leak).
    function transferConfidential(
        address token,
        address to,
        InEuint64 calldata encAmtInput
    ) external nonReentrant {
        if (token == address(0) || to == address(0)) revert InvalidInput();
        if (to == msg.sender) revert InvalidInput();
        if (!initialized[token][msg.sender]) revert NoBalance();

        euint64 amount = FHE.asEuint64(encAmtInput);
        FHE.allowThis(amount);

        euint64 senderBal = encBalance[token][msg.sender];
        ebool ok = FHE.gte(senderBal, amount);
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        euint64 actual = FHE.select(ok, amount, zero);
        FHE.allowThis(actual);

        // Decrement sender
        euint64 newSender = FHE.sub(senderBal, actual);
        FHE.allowThis(newSender);
        FHE.allow(newSender, msg.sender);
        encBalance[token][msg.sender] = newSender;

        // Increment recipient (lazy-init)
        if (initialized[token][to]) {
            euint64 newTo = FHE.add(encBalance[token][to], actual);
            FHE.allowThis(newTo);
            FHE.allow(newTo, to);
            encBalance[token][to] = newTo;
        } else {
            FHE.allow(actual, to);
            encBalance[token][to] = actual;
            initialized[token][to] = true;
        }

        emit ConfidentialTransferred(token, msg.sender, to);
    }

    // ─── Withdraw (encrypted → public, 2-step) ─────────────

    /// @notice Step 1 — open the encrypted balance for TN reveal.
    ///         User fetches the revealed value off-chain via decryptForView.
    function requestWithdraw(address token) external nonReentrant {
        if (!initialized[token][msg.sender]) revert NoBalance();
        FHE.allowGlobal(encBalance[token][msg.sender]);
        emit WithdrawRequested(token, msg.sender);
    }

    /// @notice Step 2 — submit the revealed balance + TN signature, plus
    ///         the public amount to withdraw. Contract verifies the sig
    ///         and transfers up to that amount.
    function executeWithdraw(
        address token,
        uint256 amount,
        uint64 revealedBalance,
        bytes calldata sig
    ) external nonReentrant {
        if (!initialized[token][msg.sender]) revert NoBalance();
        if (amount == 0 || amount > type(uint64).max) revert InvalidInput();
        if (uint64(amount) > revealedBalance) revert InsufficientReveal();

        // Verify the TN reveal matches the encrypted balance handle.
        FHE.publishDecryptResult(
            encBalance[token][msg.sender],
            revealedBalance,
            sig
        );

        // Decrement encrypted balance by the public amount
        euint64 dec = FHE.asEuint64(uint64(amount));
        FHE.allowThis(dec);
        euint64 newBal = FHE.sub(encBalance[token][msg.sender], dec);
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
        encBalance[token][msg.sender] = newBal;

        // Transfer public ERC-20 back to the user
        totalDeposited[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(token, msg.sender, amount);
    }

    // ─── Views ──────────────────────────────────────────────

    /// @notice Encrypted balance handle. Only the user can decrypt.
    function getMyBalance(address token) external view returns (euint64) {
        return encBalance[token][msg.sender];
    }

    function isInitialized(address token, address user) external view returns (bool) {
        return initialized[token][user];
    }
}
