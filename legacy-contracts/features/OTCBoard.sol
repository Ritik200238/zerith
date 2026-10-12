// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title OTCBoard — Private OTC request board for whale-sized trades
/// @notice Users post encrypted buy/sell requests. Counterparties see that a request exists
///         for a token pair, but NOT the size. FHE.gte() + FHE.lte() verify quotes
///         are within the requester's acceptable price range.
/// @dev Whales can buy/sell without moving the market (nobody sees the order size).
contract OTCBoard is ReentrancyGuard, FHEConstants {
    enum RequestStatus { ACTIVE, MATCHED, CANCELLED, EXPIRED }

    struct OTCRequest {
        address requester;
        address tokenWant;       // Plaintext: what they want (for discoverability)
        address tokenOffer;      // Plaintext: what they offer
        euint128 encAmount;      // ENCRYPTED: how much they want (hides whale size)
        euint128 encMinPrice;    // ENCRYPTED: minimum acceptable price
        euint128 encMaxPrice;    // ENCRYPTED: maximum acceptable price
        RequestStatus status;
        uint256 deadline;
    }

    struct OTCQuote {
        address quoter;
        euint128 encQuotePrice;  // ENCRYPTED: quoted price per unit
        euint128 encQuoteAmount; // ENCRYPTED: how much they can fill
        bool accepted;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();

    mapping(uint256 => OTCRequest) public requests;
    mapping(uint256 => OTCQuote[]) private quotes;
    uint256 public nextRequestId;

    // Encrypted uint64.max sentinel — used to gate amount*price overflow into uint64 settlement.
    // Computed once in constructor, reused for every acceptQuote check.
    euint128 internal MAX_U64_AS_E128;

    event RequestPosted(uint256 indexed requestId, address indexed requester, address tokenWant, address tokenOffer, uint256 deadline);
    event QuoteSubmitted(uint256 indexed requestId, uint256 quoteIndex, address indexed quoter);
    event QuoteAccepted(uint256 indexed requestId, uint256 quoteIndex);
    event RequestCancelled(uint256 indexed requestId);
    event RequestExpired(uint256 indexed requestId);
    event TradeCompleted(bytes32 indexed partyAHash, bytes32 indexed partyBHash, uint256 requestId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        _initFHEConstants();
        // 2^64 - 1 = 18446744073709551615; literal works for euint128.
        MAX_U64_AS_E128 = FHE.asEuint128(18446744073709551615);
        FHE.allowThis(MAX_U64_AS_E128);
    }

    /// @notice Post a private OTC request
    /// @param tokenWant Token the requester wants to buy
    /// @param tokenOffer Token the requester is selling
    /// @param encAmount Encrypted amount wanted (hides whale size)
    /// @param encMinPrice Encrypted minimum acceptable price
    /// @param encMaxPrice Encrypted maximum acceptable price
    /// @param deadline Request expiration timestamp
    function postRequest(
        address tokenWant,
        address tokenOffer,
        InEuint128 calldata encAmount,
        InEuint128 calldata encMinPrice,
        InEuint128 calldata encMaxPrice,
        uint256 deadline
    ) external whenNotPaused returns (uint256 requestId) {
        if (tokenWant == tokenOffer) revert InvalidInput();
        if (deadline <= block.timestamp) revert Expired();

        requestId = nextRequestId++;
        euint128 amount = FHE.asEuint128(encAmount);
        euint128 minP = FHE.asEuint128(encMinPrice);
        euint128 maxP = FHE.asEuint128(encMaxPrice);

        requests[requestId] = OTCRequest({
            requester: msg.sender,
            tokenWant: tokenWant,
            tokenOffer: tokenOffer,
            encAmount: amount,
            encMinPrice: minP,
            encMaxPrice: maxP,
            status: RequestStatus.ACTIVE,
            deadline: deadline
        });

        // ACL: contract uses for matching, requester can unseal own data
        FHE.allowThis(amount);
        FHE.allowThis(minP);
        FHE.allowThis(maxP);
        FHE.allowSender(amount);
        FHE.allowSender(minP);
        FHE.allowSender(maxP);

        emit RequestPosted(requestId, msg.sender, tokenWant, tokenOffer, deadline);
    }

    /// @notice Submit a quote for an OTC request
    /// @param requestId The request to quote on
    /// @param encQuotePrice Encrypted price per unit
    /// @param encQuoteAmount Encrypted amount offered
    function submitQuote(
        uint256 requestId,
        InEuint128 calldata encQuotePrice,
        InEuint128 calldata encQuoteAmount
    ) external whenNotPaused {
        OTCRequest storage req = requests[requestId];
        if (req.status != RequestStatus.ACTIVE) revert InvalidState();
        if (block.timestamp >= req.deadline) revert Expired();
        if (req.requester == msg.sender) revert InvalidInput();

        euint128 price = FHE.asEuint128(encQuotePrice);
        euint128 amount = FHE.asEuint128(encQuoteAmount);

        quotes[requestId].push(OTCQuote({
            quoter: msg.sender,
            encQuotePrice: price,
            encQuoteAmount: amount,
            accepted: false
        }));

        uint256 quoteIndex = quotes[requestId].length - 1;

        // ACL: contract, requester, and quoter can all access this quote
        FHE.allowThis(price);
        FHE.allowThis(amount);
        FHE.allow(price, req.requester);
        FHE.allowSender(price);
        FHE.allow(amount, req.requester);
        FHE.allowSender(amount);

        emit QuoteSubmitted(requestId, quoteIndex, msg.sender);
    }

    /// @notice Requester accepts a quote — verifies price is within range
    /// @dev FHE ops: gte(1), lte(1), and(1), select(1) = 4 ops
    function acceptQuote(uint256 requestId, uint256 quoteIndex)
        external
        whenNotPaused
        nonReentrant
    {
        OTCRequest storage req = requests[requestId];
        if (req.requester != msg.sender) revert Unauthorized();
        if (req.status != RequestStatus.ACTIVE) revert InvalidState();
        if (quoteIndex >= quotes[requestId].length) revert InvalidInput();

        OTCQuote storage quote = quotes[requestId][quoteIndex];
        if (quote.accepted) revert InvalidState();

        // Verify quote price is within requester's acceptable range.
        ebool aboveMin = FHE.gte(quote.encQuotePrice, req.encMinPrice);
        ebool belowMax = FHE.lte(quote.encQuotePrice, req.encMaxPrice);
        ebool inRange = FHE.and(aboveMin, belowMax);

        // Settlement legs: requester gets `quoteAmount` of tokenWant; quoter gets
        // `quoteAmount * quotePrice` of tokenOffer. Both legs zero-replace on failure.
        //
        // Audit fix (Tier-2): the previous version cast euint128 → euint64 directly,
        // which SILENTLY TRUNCATES for amount*price > 2^64-1, sending the wrong
        // number of tokens. Now we add an encrypted overflow guard:
        // `fitsInU64 = (amount128 ≤ MAX_U64) AND (payment128 ≤ MAX_U64)`, combine
        // with `inRange`, and zero-replace BOTH legs when the combined predicate
        // is false. Result: either both legs settle the intended amounts, or both
        // legs settle zero — never a half-trade with truncated values. Privacy
        // preserved: the predicate is encrypted, so the public reason for a
        // zero-settlement is indistinguishable from any other zero-settlement.
        euint128 payment128_raw = FHE.mul(quote.encQuoteAmount, quote.encQuotePrice);
        ebool amountFits = FHE.lte(quote.encQuoteAmount, MAX_U64_AS_E128);
        ebool paymentFits = FHE.lte(payment128_raw, MAX_U64_AS_E128);
        ebool safe = FHE.and(FHE.and(inRange, amountFits), paymentFits);

        euint128 amount128 = FHE.select(safe, quote.encQuoteAmount, ZERO_128);
        euint128 payment128 = FHE.select(safe, payment128_raw, ZERO_128);
        FHE.allowThis(amount128);
        FHE.allowThis(payment128);

        // Now amount128 + payment128 are guaranteed to fit in uint64. The cast
        // below cannot truncate because the FHE.select above clamps to 0 in the
        // unsafe branch.
        euint64 amountToWant = FHE.asEuint64(amount128);
        euint64 amountToOffer = FHE.asEuint64(payment128);
        FHE.allowThis(amountToWant);
        FHE.allowThis(amountToOffer);
        FHE.allowTransient(amountToWant, address(vault));
        FHE.allow(amountToWant, address(vault));
        FHE.allowTransient(amountToOffer, address(vault));
        FHE.allow(amountToOffer, address(vault));

        // Requester gets `amount` of tokenWant from quoter
        vault.settleTrade(quote.quoter, req.requester, req.tokenWant, amountToWant);
        // Quoter gets `amount * price` of tokenOffer from requester
        vault.settleTrade(req.requester, quote.quoter, req.tokenOffer, amountToOffer);

        quote.accepted = true;
        req.status = RequestStatus.MATCHED;

        bytes32 salt = keccak256(abi.encodePacked(block.number, block.prevrandao));
        emit TradeCompleted(
            keccak256(abi.encodePacked(req.requester, salt)),
            keccak256(abi.encodePacked(quote.quoter, salt)),
            requestId
        );
        emit QuoteAccepted(requestId, quoteIndex);
    }

    /// @notice Cancel an OTC request (requester only)
    function cancelRequest(uint256 requestId) external {
        OTCRequest storage req = requests[requestId];
        if (req.requester != msg.sender) revert Unauthorized();
        if (req.status != RequestStatus.ACTIVE) revert InvalidState();

        req.status = RequestStatus.CANCELLED;
        emit RequestCancelled(requestId);
    }

    /// @notice Mark an expired request as EXPIRED (anyone can sweep)
    /// @dev Closes the audit gap where the EXPIRED status was unreachable on-chain.
    ///      Permissionless because the deadline check is the only authorization needed.
    function expireRequest(uint256 requestId) external {
        OTCRequest storage req = requests[requestId];
        if (req.status != RequestStatus.ACTIVE) revert InvalidState();
        if (block.timestamp < req.deadline) revert InvalidState();

        req.status = RequestStatus.EXPIRED;
        emit RequestExpired(requestId);
    }

    /// @notice Get request details
    function getRequest(uint256 requestId) external view returns (
        address requester,
        address tokenWant,
        address tokenOffer,
        RequestStatus status,
        uint256 deadline,
        uint256 quoteCount
    ) {
        OTCRequest storage r = requests[requestId];
        return (r.requester, r.tokenWant, r.tokenOffer, r.status, r.deadline, quotes[requestId].length);
    }

    /// @notice Get quote details (encrypted fields only readable by authorized parties)
    function getQuote(uint256 requestId, uint256 quoteIndex) external view returns (
        address quoter,
        euint128 encQuotePrice,
        euint128 encQuoteAmount,
        bool accepted
    ) {
        OTCQuote storage q = quotes[requestId][quoteIndex];
        return (q.quoter, q.encQuotePrice, q.encQuoteAmount, q.accepted);
    }

    function getRequestCount() external view returns (uint256) {
        return nextRequestId;
    }
}
