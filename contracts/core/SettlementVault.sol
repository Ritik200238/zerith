// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    FHE,
    euint64,
    externalEuint64,
    sharedEuint64,
    ebool,
    sharedEbool
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFHERC20} from "../interfaces/IFHERC20.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title SettlementVault — FHERC20 custody, encrypted balances and settlement escrow
/// @notice Users deposit FHERC20 tokens and hold encrypted balances here. Feature
///         contracts (auctions, payroll) lock a user's funds into escrow when the user
///         commits, and pay out of that escrow later, so a settlement can never move
///         more than was actually committed.
/// @dev Built for CoFHE 1.0: user inputs arrive as externalEuint64 + proof, and
///      encrypted values crossing contract boundaries use shared handles, so the vault
///      only ever acts on a handle its caller explicitly handed over.
contract SettlementVault is Ownable2Step, ReentrancyGuard, FHEConstants {
    /// @notice Encrypted balance ledger: user => token => encrypted balance
    mapping(address => mapping(address => euint64)) private encBalances;

    /// @notice Escrow held for each settler contract: settler => token => encrypted total
    mapping(address => mapping(address => euint64)) private escrowed;

    /// @notice Feature contracts allowed to lock and release escrow
    mapping(address => bool) public authorizedSettlers;

    /// @notice Whitelisted FHERC20 tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Platform registry for pause checks
    IPlatformRegistry public registry;

    event Deposited(address indexed user, address indexed token);
    event Withdrawn(address indexed user, address indexed token);
    event FundsLocked(address indexed settler, address indexed user, address indexed token);
    event FundsReleased(address indexed settler, address indexed to, address indexed token);
    event SettlerAuthorized(address indexed settler);
    event SettlerRevoked(address indexed settler);
    event TokenWhitelisted(address indexed token);
    event TokenDelisted(address indexed token);

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    modifier onlyAuthorizedSettler() {
        if (!authorizedSettlers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address _token, address _registry, address _admin)
        Ownable(_admin)
    {
        if (_token == address(0)) revert InvalidInput();
        if (_registry == address(0)) revert InvalidInput();
        registry = IPlatformRegistry(_registry);
        supportedTokens[_token] = true;
        _initFHEConstants();
        emit TokenWhitelisted(_token);
    }

    // ─── User Operations ────────────────────────────────────

    /// @notice Deposit FHERC20 tokens into the vault
    /// @dev The user must call token.setOperator(vault, expiration) first. FHERC20
    ///      zero-replaces a transfer the sender can't cover, so the vault credits only
    ///      what the token reports as moved — never the requested amount.
    function deposit(address token, externalEuint64 encAmount, bytes calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        euint64 amount = FHE.asEuint64(encAmount, proof);

        FHE.allowTransient(amount, token);
        euint64 received = IFHERC20(token).confidentialTransferFrom(msg.sender, address(this), amount);

        encBalances[msg.sender][token] = FHE.add(encBalances[msg.sender][token], received);
        FHE.allowThis(encBalances[msg.sender][token]);
        FHE.allowSender(encBalances[msg.sender][token]);

        emit Deposited(msg.sender, token);
    }

    /// @notice Withdraw FHERC20 tokens from the vault
    /// @dev All-or-nothing: withdraws `amount` if the balance covers it, otherwise 0.
    ///      Never reverts on the encrypted condition.
    function withdraw(address token, externalEuint64 encAmount, bytes calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        euint64 amount = FHE.asEuint64(encAmount, proof);

        euint64 withdrawn = FHE.select(FHE.lte(amount, encBalances[msg.sender][token]), amount, ZERO_64);

        FHE.allowTransient(withdrawn, token);
        // Debit exactly what was sent (sent <= withdrawn <= balance, so no underflow).
        euint64 sent = IFHERC20(token).confidentialTransfer(msg.sender, withdrawn);
        encBalances[msg.sender][token] = FHE.sub(encBalances[msg.sender][token], sent);

        FHE.allowThis(encBalances[msg.sender][token]);
        FHE.allowSender(encBalances[msg.sender][token]);

        emit Withdrawn(msg.sender, token);
    }

    /// @notice A user's encrypted vault balance handle (only the user can unseal it)
    function getEncBalance(address user, address token) external view returns (euint64) {
        return encBalances[user][token];
    }

    // ─── Escrow (Feature Contracts Only) ────────────────────

    /// @notice Move up to `amount` of `user`'s balance into the caller's escrow pool.
    /// @dev All-or-nothing: locks `amount` if the user can cover it, otherwise 0. The
    ///      caller must share `amount` with this vault. Returns the locked amount as a
    ///      share to the caller, which also keeps persistent access to it.
    function lockFunds(address user, address token, sharedEuint64 sharedAmount)
        external
        onlyAuthorizedSettler
        whenNotPaused
        nonReentrant
        returns (sharedEuint64)
    {
        if (!supportedTokens[token]) revert InvalidInput();
        if (user == address(0)) revert InvalidInput();
        euint64 amount = FHE.receiveEuint64Param(sharedAmount);

        euint64 locked = FHE.select(FHE.lte(amount, encBalances[user][token]), amount, ZERO_64);
        encBalances[user][token] = FHE.sub(encBalances[user][token], locked);
        escrowed[msg.sender][token] = FHE.add(escrowed[msg.sender][token], locked);

        FHE.allowThis(encBalances[user][token]);
        FHE.allow(encBalances[user][token], user);
        FHE.allowThis(escrowed[msg.sender][token]);
        FHE.allowThis(locked);
        FHE.allow(locked, msg.sender);

        emit FundsLocked(msg.sender, user, token);
        return FHE.shareEuint64(locked, msg.sender);
    }

    /// @notice Pay `amount` out of the caller's escrow pool to `to`'s vault balance.
    /// @dev Capped at the caller's pool, so a settler can only pay out funds it locked —
    ///      never another settler's escrow or anyone's spendable balance.
    function releaseFunds(address to, address token, sharedEuint64 sharedAmount)
        external
        onlyAuthorizedSettler
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        if (to == address(0)) revert InvalidInput();
        euint64 amount = FHE.receiveEuint64Param(sharedAmount);

        euint64 pool = escrowed[msg.sender][token];
        euint64 released = FHE.select(FHE.lte(amount, pool), amount, ZERO_64);
        escrowed[msg.sender][token] = FHE.sub(pool, released);
        encBalances[to][token] = FHE.add(encBalances[to][token], released);

        FHE.allowThis(escrowed[msg.sender][token]);
        FHE.allowThis(encBalances[to][token]);
        FHE.allow(encBalances[to][token], to);

        emit FundsReleased(msg.sender, to, token);
    }

    /// @notice Encrypted "balance >= threshold", shared with the caller.
    /// @dev For proof-of-reserves style settlers, which only ever pass msg.sender as
    ///      `user`. The balance itself is never shared.
    function balanceAtLeast(address user, address token, uint64 threshold)
        external
        onlyAuthorizedSettler
        returns (sharedEbool)
    {
        if (!supportedTokens[token]) revert InvalidInput();
        ebool meets = FHE.gte(encBalances[user][token], FHE.asEuint64(threshold));
        FHE.allowThis(meets);
        return FHE.shareEbool(meets, msg.sender);
    }

    // ─── Admin Operations ───────────────────────────────────

    function addAuthorizedSettler(address settler) external onlyOwner {
        if (settler == address(0)) revert InvalidInput();
        if (authorizedSettlers[settler]) revert InvalidState();
        authorizedSettlers[settler] = true;
        emit SettlerAuthorized(settler);
    }

    function removeAuthorizedSettler(address settler) external onlyOwner {
        if (!authorizedSettlers[settler]) revert InvalidState();
        authorizedSettlers[settler] = false;
        emit SettlerRevoked(settler);
    }

    function addSupportedToken(address token) external onlyOwner {
        if (token == address(0)) revert InvalidInput();
        if (supportedTokens[token]) revert InvalidState();
        supportedTokens[token] = true;
        emit TokenWhitelisted(token);
    }

    function removeSupportedToken(address token) external onlyOwner {
        if (!supportedTokens[token]) revert InvalidState();
        supportedTokens[token] = false;
        emit TokenDelisted(token);
    }
}
