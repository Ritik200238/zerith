// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
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
/// @dev Escrow: a feature contract can lock a user's funds when they commit (a bid, a
///      payroll split) and release them later. Locked funds leave the user's spendable
///      balance and sit in a per-settler pool, so settlement can never pay out more than
///      was actually committed — the fix for non-atomic, zero-replaced settlement legs.
contract SettlementVault is Ownable2Step, ReentrancyGuard, FHEConstants {
    /// @notice Encrypted balance ledger: user => token => encrypted balance
    /// @dev euint64 matches FHERC20 standard. Feature contracts compute price*amount
    ///      as temporary euint128 variables, but settlement amounts always fit euint64.
    mapping(address => mapping(address => euint64)) private encBalances;

    /// @notice Escrowed funds held for a settler contract: settler => token => encrypted total
    mapping(address => mapping(address => euint64)) private escrowed;

    /// @notice Authorized settler contracts (feature contracts that can call settleTrade)
    mapping(address => bool) public authorizedSettlers;

    /// @notice Whitelisted FHERC20 tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Platform registry for pause checks
    IPlatformRegistry public registry;

    event Deposited(address indexed user, address indexed token);
    event Withdrawn(address indexed user, address indexed token);
    event TradeSettled(address indexed from, address indexed to, address indexed token);
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
    /// @dev User must call token.setOperator(vault, expiration) first
    /// @dev FHE ops: add(1). ACL: allowThis + allow(user)
    function deposit(address token, InEuint64 calldata encAmount)
        external
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        euint64 amount = FHE.asEuint64(encAmount);

        // FHERC20.confidentialTransferFrom reads `amount` inside the token
        // contract — grant it transient ACL access so the precompile doesn't
        // revert with ACLNotAllowed(handle, token). Mirrors the pattern in
        // SealedAuction.settle() lines 375-380.
        FHE.allowTransient(amount, token);

        // Transfer FHERC20 from user to vault. FHERC20 zero-replaces a transfer the
        // sender can't cover, so credit only what actually arrived — never `amount`.
        euint64 received = IFHERC20(token).confidentialTransferFrom(msg.sender, address(this), amount);

        // Credit user's vault balance
        encBalances[msg.sender][token] = FHE.add(encBalances[msg.sender][token], received);

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

        // Grant transient ACL so the token contract can read `withdrawn`
        // inside its confidentialTransfer call.
        FHE.allowTransient(withdrawn, token);

        // Transfer FHERC20 from vault to user, then debit exactly what was sent
        // (sent <= withdrawn <= balance, so the ledger can never underflow).
        euint64 sent = IFHERC20(token).confidentialTransfer(msg.sender, withdrawn);
        encBalances[msg.sender][token] = FHE.sub(encBalances[msg.sender][token], sent);

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

    // ─── Escrow (Feature Contracts Only) ────────────────────

    /// @notice Move up to `amount` of `user`'s balance into the caller's escrow pool.
    /// @dev All-or-nothing: locks `amount` if the user can cover it, otherwise 0.
    ///      Never reverts on the encrypted condition. The caller must grant this vault
    ///      transient access to `amount`. Returns the handle of what was locked; the
    ///      caller (and only the caller) may use it.
    function lockFunds(address user, address token, euint64 amount)
        external
        onlyAuthorizedSettler
        whenNotPaused
        nonReentrant
        returns (euint64 locked)
    {
        if (!supportedTokens[token]) revert InvalidInput();
        if (user == address(0)) revert InvalidInput();

        locked = FHE.select(FHE.lte(amount, encBalances[user][token]), amount, ZERO_64);
        encBalances[user][token] = FHE.sub(encBalances[user][token], locked);
        escrowed[msg.sender][token] = FHE.add(escrowed[msg.sender][token], locked);

        FHE.allowThis(encBalances[user][token]);
        FHE.allow(encBalances[user][token], user);
        FHE.allowThis(escrowed[msg.sender][token]);
        FHE.allowThis(locked);
        FHE.allow(locked, msg.sender);

        emit FundsLocked(msg.sender, user, token);
    }

    /// @notice Pay `amount` out of the caller's escrow pool to `to`'s vault balance.
    /// @dev Capped at the caller's pool, so a settler can only ever pay out funds it
    ///      locked — never other settlers' escrow or users' spendable balances.
    function releaseFunds(address to, address token, euint64 amount)
        external
        onlyAuthorizedSettler
        whenNotPaused
        nonReentrant
    {
        if (!supportedTokens[token]) revert InvalidInput();
        if (to == address(0)) revert InvalidInput();

        euint64 pool = escrowed[msg.sender][token];
        euint64 released = FHE.select(FHE.lte(amount, pool), amount, ZERO_64);
        escrowed[msg.sender][token] = FHE.sub(pool, released);
        encBalances[to][token] = FHE.add(encBalances[to][token], released);

        FHE.allowThis(escrowed[msg.sender][token]);
        FHE.allowThis(encBalances[to][token]);
        FHE.allow(encBalances[to][token], to);

        emit FundsReleased(msg.sender, to, token);
    }

    /// @notice Encrypted "balance >= threshold" for a user, for proof-of-reserves style
    ///         consumers. Returns an ebool the caller may use; the balance stays sealed.
    /// @dev Restricted to authorized settlers, which are admin-vetted contracts that
    ///      only ever pass msg.sender as `user`.
    function balanceAtLeast(address user, address token, uint64 threshold)
        external
        onlyAuthorizedSettler
        returns (ebool meets)
    {
        if (!supportedTokens[token]) revert InvalidInput();
        meets = FHE.gte(encBalances[user][token], FHE.asEuint64(threshold));
        FHE.allowThis(meets);
        FHE.allow(meets, msg.sender);
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
