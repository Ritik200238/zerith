// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFHERC20} from "../interfaces/IFHERC20.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title SettlementVault — Centralized FHERC20 custody and encrypted settlement
/// @notice All feature contracts settle trades through this vault. Users deposit/withdraw
///         tokens here. The vault holds encrypted balance ledgers and executes transfers
///         on behalf of authorized feature contracts.
/// @dev Single custodian pattern reduces ACL surface area. Feature contracts never hold tokens.
contract SettlementVault is Ownable2Step, ReentrancyGuard, FHEConstants {
    /// @notice Encrypted balance ledger: user => token => encrypted balance
    /// @dev euint64 matches FHERC20 standard. Feature contracts compute price*amount
    ///      as temporary euint128 variables, but settlement amounts always fit euint64.
    mapping(address => mapping(address => euint64)) private encBalances;

    /// @notice Authorized settler contracts (feature contracts that can call settleTrade)
    mapping(address => bool) public authorizedSettlers;

    /// @notice Whitelisted FHERC20 tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Platform registry for pause checks
    IPlatformRegistry public registry;

    event Deposited(address indexed user, address indexed token);
    event Withdrawn(address indexed user, address indexed token);
    event TradeSettled(address indexed from, address indexed to, address indexed token);
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
    /// @dev User must call token.setOperator(vault, expiration) first
    /// @dev FHE ops: add(1). ACL: allowThis + allow(user)
    function deposit(address token, InEuint64 calldata encAmount)
        external
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        euint64 amount = FHE.asEuint64(encAmount);

        // Transfer FHERC20 from user to vault
        IFHERC20(token).confidentialTransferFrom(msg.sender, address(this), amount);

        // Credit user's vault balance
        encBalances[msg.sender][token] = FHE.add(encBalances[msg.sender][token], amount);

        // ACL: vault can use this balance in future txns, user can unseal
        FHE.allowThis(encBalances[msg.sender][token]);
        FHE.allowSender(encBalances[msg.sender][token]);

        emit Deposited(msg.sender, token);
    }

    /// @notice Withdraw FHERC20 tokens from the vault
    /// @dev Uses zero-replacement pattern: if amount > balance, withdraws 0
    /// @dev FHE ops: lte(1), select(1), sub(1). ACL: allowThis + allow(user)
    function withdraw(address token, InEuint64 calldata encAmount)
        external
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        euint64 amount = FHE.asEuint64(encAmount);

        // Zero-replacement: withdraw 0 if insufficient balance (never revert)
        euint64 withdrawn = FHE.select(
            FHE.lte(amount, encBalances[msg.sender][token]),
            amount,
            ZERO_64
        );

        // Debit user's vault balance
        encBalances[msg.sender][token] = FHE.sub(encBalances[msg.sender][token], withdrawn);

        // Transfer FHERC20 from vault to user
        IFHERC20(token).confidentialTransfer(msg.sender, withdrawn);

        // ACL: vault can use updated balance, user can unseal
        FHE.allowThis(encBalances[msg.sender][token]);
        FHE.allowSender(encBalances[msg.sender][token]);

        emit Withdrawn(msg.sender, token);
    }

    /// @notice Get own encrypted balance handle (for unsealing via cofhejs)
    function getEncBalance(address user, address token) external view returns (euint64) {
        return encBalances[user][token];
    }

    /// @notice Delegate read access of caller's encrypted balance to another contract.
    /// @dev Required for cross-contract reads like PortfolioTracker. The consumer must
    ///      be able to operate on the handle (FHE ops require ACL access). This grants
    ///      that access without exposing the underlying value to the consumer's owner.
    /// @dev Lazy-initializes balance to encrypted zero on first call (otherwise
    ///      FHE.allow on an uninitialized handle reverts with SenderNotAllowed).
    /// @param consumer Contract that needs to read this balance
    /// @param token Token whose balance is being delegated
    function delegateBalanceRead(address consumer, address token) external whenNotPaused {
        if (consumer == address(0)) revert InvalidInput();
        if (!supportedTokens[token]) revert InvalidInput();

        euint64 balance = encBalances[msg.sender][token];
        // If first ever access, initialize handle to encrypted zero
        if (euint64.unwrap(balance) == bytes32(0)) {
            balance = FHE.asEuint64(0);
            encBalances[msg.sender][token] = balance;
            FHE.allowThis(balance);
            FHE.allow(balance, msg.sender);
        }
        FHE.allow(balance, consumer);
    }

    // ─── Settlement (Feature Contracts Only) ────────────────

    /// @notice Execute an encrypted settlement between two users
    /// @dev Only callable by authorized settler contracts (OrderBook, Auction, etc.)
    /// @dev Uses zero-replacement: if `from` has insufficient balance, transfers 0
    /// @dev FHE ops: lte(1), select(1), sub(1), add(1). ACL: allowThis + allow for both users
    function settleTrade(
        address from,
        address to,
        address token,
        euint64 amount
    ) external onlyAuthorizedSettler whenNotPaused nonReentrant {
        if (!supportedTokens[token]) revert InvalidInput();
        if (from == to) revert InvalidInput();
        if (from == address(0) || to == address(0)) revert InvalidInput();

        // Zero-replacement: transfer 0 if insufficient balance
        euint64 transferred = FHE.select(
            FHE.lte(amount, encBalances[from][token]),
            amount,
            ZERO_64
        );

        // Debit from, credit to
        encBalances[from][token] = FHE.sub(encBalances[from][token], transferred);
        encBalances[to][token] = FHE.add(encBalances[to][token], transferred);

        // ACL: vault can use both balances, each user can unseal their own
        FHE.allowThis(encBalances[from][token]);
        FHE.allowThis(encBalances[to][token]);
        FHE.allow(encBalances[from][token], from);
        FHE.allow(encBalances[to][token], to);

        emit TradeSettled(from, to, token);
    }

    // ─── Admin Operations ───────────────────────────────────

    /// @notice Authorize a feature contract to call settleTrade
    function addAuthorizedSettler(address settler) external onlyOwner {
        if (settler == address(0)) revert InvalidInput();
        if (authorizedSettlers[settler]) revert InvalidState();
        authorizedSettlers[settler] = true;
        emit SettlerAuthorized(settler);
    }

    /// @notice Revoke a feature contract's settlement authorization
    function removeAuthorizedSettler(address settler) external onlyOwner {
        if (!authorizedSettlers[settler]) revert InvalidState();
        authorizedSettlers[settler] = false;
        emit SettlerRevoked(settler);
    }

    /// @notice Whitelist a new FHERC20 token
    function addSupportedToken(address token) external onlyOwner {
        if (token == address(0)) revert InvalidInput();
        if (supportedTokens[token]) revert InvalidState();
        supportedTokens[token] = true;
        emit TokenWhitelisted(token);
    }

    /// @notice Remove a token from the whitelist
    function removeSupportedToken(address token) external onlyOwner {
        if (!supportedTokens[token]) revert InvalidState();
        supportedTokens[token] = false;
        emit TokenDelisted(token);
    }
}
