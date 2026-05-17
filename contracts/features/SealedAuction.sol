// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, eaddress, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

interface IAuctionClaim {
    function mint(address winner, address sourceContract, uint256 sourceId, string calldata claimType) external returns (uint256);
}

/// @title SealedAuction — Sealed-bid token auctions with anti-snipe timer
/// @notice Seller lists tokens, bidders submit encrypted bids. FHE.gt() + FHE.max()
///         find the highest bid without revealing any losing bids. Anti-snipe extends
///         deadline on late bids (amount stays hidden).
/// @notice BLIND FLOOR AUCTION (createBlindAuction): seller's encrypted reserve price
///         is NEVER decrypted, ever — not at settlement, not after. Contract computes
///         FHE.gte(highestBid, reserve) → publishes only the resulting boolean via
///         Threshold Network. Bidders can never reverse-engineer the floor.
///         A new game-theoretic equilibrium: "strategy-proof under permanent
///         information asymmetry." Only possible because of FHE.
/// @dev Async 2-step flow: closeAuction → wait → revealWinner(Blind) → settleAuction
contract SealedAuction is ReentrancyGuard, FHEConstants {
    enum AuctionStatus { OPEN, CLOSED, REVEALED, SETTLED, CANCELLED, RESERVE_NOT_MET }

    struct Auction {
        address seller;
        address token;           // Token being auctioned
        address paymentToken;    // Token bidders pay with
        uint256 amount;          // Plaintext: what's for sale (public for discoverability)
        uint256 deadline;        // Plaintext: public deadline
        uint256 originalDeadline;
        uint256 bidCount;        // Plaintext: number of bids (not amounts)
        euint128 highestBid;     // ENCRYPTED until reveal
        eaddress highestBidder;  // ENCRYPTED until reveal
        uint128 revealedBid;     // Set after async decrypt
        address revealedBidder;  // Set after async decrypt
        AuctionStatus status;
        uint256 snipeExtension;  // Seconds to extend on late bids

        // Blind Floor extensions — only meaningful when hasReserve == true
        bool hasReserve;            // true if this is a Blind Floor auction
        euint128 encReserve;        // ENCRYPTED — NEVER decrypted, ever
        euint64 encReserveMet;      // ENCRYPTED 0/1 — computed at close, decrypted at reveal
        bool revealedReserveMet;    // Plaintext result of the boolean reveal
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    IAuctionClaim public claimNFT;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => euint128)) private bids;
    mapping(uint256 => mapping(address => bool)) public hasBid;
    uint256 public nextAuctionId;

    // Encrypted 1 (sentinel) used by Blind Floor to convert ebool → euint64 via FHE.select
    euint64 internal ONE_64_INT;

    uint256 public constant DEFAULT_SNIPE_WINDOW = 60;      // Last 60 seconds
    uint256 public constant DEFAULT_SNIPE_EXTENSION = 120;   // Extend by 2 minutes
    uint256 public constant MIN_DURATION = 300;               // 5 minutes minimum

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address token, uint256 amount, uint256 deadline);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 newDeadline);
    event AuctionClosed(uint256 indexed auctionId);
    event WinnerRevealed(uint256 indexed auctionId, address winner, uint128 winningBid);
    event AuctionSettled(uint256 indexed auctionId);
    event AuctionCancelled(uint256 indexed auctionId);
    event TradeCompleted(bytes32 indexed partyAHash, bytes32 indexed partyBHash, uint256 auctionId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry, address _claimNFT) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        if (_claimNFT != address(0)) claimNFT = IAuctionClaim(_claimNFT);
        _initFHEConstants();
        ONE_64_INT = FHE.asEuint64(1);
        FHE.allowThis(ONE_64_INT);
    }

    /// @notice Seller creates a new auction
    /// @param token Token being auctioned
    /// @param paymentToken Token bidders pay with
    /// @param amount Amount of tokens for sale (plaintext)
    /// @param duration Auction duration in seconds
    /// @param snipeExtension Seconds to extend on late bids (0 = use default)
    function createAuction(
        address token,
        address paymentToken,
        uint256 amount,
        uint256 duration,
        uint256 snipeExtension
    ) external whenNotPaused returns (uint256 auctionId) {
        if (token == paymentToken) revert InvalidInput();
        if (amount == 0) revert InvalidInput();
        if (duration < MIN_DURATION) revert InvalidInput();

        auctionId = nextAuctionId++;
        uint256 deadline = block.timestamp + duration;
        uint256 ext = snipeExtension > 0 ? snipeExtension : DEFAULT_SNIPE_EXTENSION;

        // Initialize encrypted highest bid to 0 and bidder to zero address
        euint128 initBid = FHE.asEuint128(0);
        eaddress initBidder = FHE.asEaddress(address(0));
        FHE.allowThis(initBid);
        FHE.allowThis(initBidder);

        auctions[auctionId] = Auction({
            seller: msg.sender,
            token: token,
            paymentToken: paymentToken,
            amount: amount,
            deadline: deadline,
            originalDeadline: deadline,
            bidCount: 0,
            highestBid: initBid,
            highestBidder: initBidder,
            revealedBid: 0,
            revealedBidder: address(0),
            status: AuctionStatus.OPEN,
            snipeExtension: ext,
            // Blind Floor fields off by default for standard auctions
            hasReserve: false,
            encReserve: initBid,         // unused; same handle as encrypted zero
            encReserveMet: ZERO_64,
            revealedReserveMet: false
        });

        emit AuctionCreated(auctionId, msg.sender, token, amount, deadline);
    }

    /// @notice Create a Blind Floor auction — encrypted reserve price that NEVER decrypts.
    /// @dev Innovation: bidders cannot reverse-engineer the floor (it's not just hidden
    ///      during the auction, it's never revealed). Contract uses FHE.gte() to compare
    ///      winning bid against the encrypted reserve and publishes only the boolean
    ///      outcome via Threshold Network. The reserve handle itself is allowThis'd to
    ///      this contract and nothing else — pure information asymmetry.
    /// @param token Token being auctioned
    /// @param paymentToken Token bidders pay with
    /// @param amount Amount of tokens for sale (plaintext)
    /// @param duration Auction duration in seconds
    /// @param snipeExtension Seconds to extend on late bids (0 = use default)
    /// @param encReserveInput Encrypted reserve price (uint128). NEVER decrypted.
    function createBlindAuction(
        address token,
        address paymentToken,
        uint256 amount,
        uint256 duration,
        uint256 snipeExtension,
        InEuint128 calldata encReserveInput
    ) external whenNotPaused returns (uint256 auctionId) {
        if (token == paymentToken) revert InvalidInput();
        if (amount == 0) revert InvalidInput();
        if (duration < MIN_DURATION) revert InvalidInput();

        auctionId = nextAuctionId++;
        uint256 deadline = block.timestamp + duration;
        uint256 ext = snipeExtension > 0 ? snipeExtension : DEFAULT_SNIPE_EXTENSION;

        euint128 initBid = FHE.asEuint128(0);
        eaddress initBidder = FHE.asEaddress(address(0));
        euint128 encReserve = FHE.asEuint128(encReserveInput);
        FHE.allowThis(initBid);
        FHE.allowThis(initBidder);
        FHE.allowThis(encReserve);
        // Reserve is NEVER FHE.allowGlobal'd — it stays sealed forever.

        auctions[auctionId] = Auction({
            seller: msg.sender,
            token: token,
            paymentToken: paymentToken,
            amount: amount,
            deadline: deadline,
            originalDeadline: deadline,
            bidCount: 0,
            highestBid: initBid,
            highestBidder: initBidder,
            revealedBid: 0,
            revealedBidder: address(0),
            status: AuctionStatus.OPEN,
            snipeExtension: ext,
            hasReserve: true,
            encReserve: encReserve,
            encReserveMet: ZERO_64,
            revealedReserveMet: false
        });

        emit AuctionCreated(auctionId, msg.sender, token, amount, deadline);
    }

    /// @notice Submit an encrypted bid on an auction
    /// @dev FHE ops: gt(1), max(1), select(1) = 3 ops per bid
    /// @dev Anti-snipe: if bid is in last SNIPE_WINDOW seconds, extends deadline
    function bid(uint256 auctionId, InEuint128 calldata encBidAmount)
        external
        whenNotPaused
    {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp >= auction.deadline) revert Expired();
        if (auction.seller == msg.sender) revert InvalidInput();
        if (hasBid[auctionId][msg.sender]) revert InvalidState();

        euint128 newBid = FHE.asEuint128(encBidAmount);

        // Core FHE: compare new bid against current highest
        ebool isHigher = FHE.gt(newBid, auction.highestBid);

        // Update highest bid and bidder using encrypted conditional logic
        auction.highestBid = FHE.max(newBid, auction.highestBid);
        auction.highestBidder = FHE.select(isHigher, FHE.asEaddress(msg.sender), auction.highestBidder);

        // ACL: contract needs persistent access for future comparisons
        FHE.allowThis(auction.highestBid);
        FHE.allowThis(auction.highestBidder);

        // Store individual bid (bidder can unseal their own bid later)
        bids[auctionId][msg.sender] = newBid;
        FHE.allowThis(newBid);
        FHE.allowSender(newBid);

        hasBid[auctionId][msg.sender] = true;
        auction.bidCount++;

        // Anti-snipe: extend deadline if bid is in the last SNIPE_WINDOW seconds
        // Note: this reveals that A bid was placed (timing metadata), but NOT the amount
        uint256 newDeadline = auction.deadline;
        if (block.timestamp > auction.deadline - DEFAULT_SNIPE_WINDOW) {
            newDeadline = block.timestamp + auction.snipeExtension;
            auction.deadline = newDeadline;
        }

        emit BidPlaced(auctionId, msg.sender, newDeadline);
    }

    /// @notice Seller closes the auction and marks winner data publicly decryptable.
    /// @dev Threshold-Network-v2 reveal: contract calls FHE.allowGlobal so any party
    ///      can call client.decryptForTx() off-chain to obtain (value, signature),
    ///      then submits to publishReveal() for on-chain verification.
    function closeAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert Unauthorized();
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp < auction.deadline) revert InvalidState();
        if (auction.bidCount == 0) revert InvalidState();

        // Mark winning bid and bidder as publicly decryptable via Threshold Network.
        FHE.allowGlobal(auction.highestBid);
        FHE.allowGlobal(auction.highestBidder);

        // BLIND FLOOR: compute encrypted "reserve met" boolean and mark IT decryptable.
        // The reserve itself stays sealed forever — only the yes/no outcome is revealed.
        if (auction.hasReserve) {
            ebool met = FHE.gte(auction.highestBid, auction.encReserve);
            euint64 metAsInt = FHE.select(met, ONE_64_INT, ZERO_64);
            auction.encReserveMet = metAsInt;
            FHE.allowThis(metAsInt);
            FHE.allowGlobal(metAsInt);
        }

        auction.status = AuctionStatus.CLOSED;
        emit AuctionClosed(auctionId);
    }

    /// @notice Publish the verified reveal of the winning bid + bidder.
    /// @dev Caller obtains (value, signature) pairs off-chain via @cofhe/sdk's
    ///      client.decryptForTx(handle).withoutPermit().execute(). Anyone can submit —
    ///      FHE.publishDecryptResult validates the Threshold Network signature on-chain.
    function revealWinner(
        uint256 auctionId,
        uint128 bidValue,
        bytes calldata bidSignature,
        address bidderValue,
        bytes calldata bidderSignature
    )
        external
        returns (uint128 winningBid, address winner)
    {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.CLOSED) revert InvalidState();
        // Blind Floor auctions must use revealWinnerBlind so the reserve outcome is
        // settled atomically with the winner reveal.
        if (auction.hasReserve) revert InvalidState();

        FHE.publishDecryptResult(auction.highestBid, bidValue, bidSignature);
        FHE.publishDecryptResult(auction.highestBidder, bidderValue, bidderSignature);

        auction.revealedBid = bidValue;
        auction.revealedBidder = bidderValue;
        auction.status = AuctionStatus.REVEALED;

        emit WinnerRevealed(auctionId, bidderValue, bidValue);
        return (bidValue, bidderValue);
    }

    /// @notice Reveal the winner of a Blind Floor auction with the reserve-met boolean.
    /// @dev Three TN-signed reveals: bid value, bidder address, and reserveMet (0/1).
    ///      The encrypted reserve itself is NEVER published — only its comparison outcome.
    function revealWinnerBlind(
        uint256 auctionId,
        uint128 bidValue,
        bytes calldata bidSignature,
        address bidderValue,
        bytes calldata bidderSignature,
        uint64 reserveMetValue,
        bytes calldata reserveMetSignature
    )
        external
        returns (uint128 winningBid, address winner, bool reserveMet)
    {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.CLOSED) revert InvalidState();
        if (!auction.hasReserve) revert InvalidState();
        if (reserveMetValue > 1) revert InvalidInput();

        FHE.publishDecryptResult(auction.highestBid, bidValue, bidSignature);
        FHE.publishDecryptResult(auction.highestBidder, bidderValue, bidderSignature);
        FHE.publishDecryptResult(auction.encReserveMet, reserveMetValue, reserveMetSignature);

        auction.revealedBid = bidValue;
        auction.revealedBidder = bidderValue;
        auction.revealedReserveMet = reserveMetValue == 1;
        auction.status = AuctionStatus.REVEALED;

        emit WinnerRevealed(auctionId, bidderValue, bidValue);
        return (bidValue, bidderValue, auction.revealedReserveMet);
    }

    /// @notice Settle the auction — transfer tokens to winner, payment to seller (minus fee)
    /// @dev Uses plaintext revealed values. Settlement via vault. Mints Claim NFT to winner.
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.REVEALED) revert InvalidState();

        // BLIND FLOOR: if the encrypted reserve was not met, no settlement happens.
        // The reserve value is still secret — only the boolean outcome was revealed.
        if (auction.hasReserve && !auction.revealedReserveMet) {
            auction.status = AuctionStatus.RESERVE_NOT_MET;
            emit AuctionCancelled(auctionId);
            return;
        }

        address winner = auction.revealedBidder;
        if (winner == address(0)) revert InvalidState();

        // Compute fee
        uint256 fee = (uint256(auction.revealedBid) * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerReceives = uint256(auction.revealedBid) - fee;

        // Encrypt the settlement amounts for vault
        euint64 auctionAmount = FHE.asEuint64(uint64(auction.amount));
        euint64 paymentToSeller = FHE.asEuint64(uint64(sellerReceives));
        euint64 feeAmount = FHE.asEuint64(uint64(fee));

        // Allow vault to access these amounts
        FHE.allowThis(auctionAmount);
        FHE.allowThis(paymentToSeller);
        FHE.allowThis(feeAmount);
        FHE.allowTransient(auctionAmount, address(vault));
        FHE.allow(auctionAmount, address(vault));
        FHE.allowTransient(paymentToSeller, address(vault));
        FHE.allow(paymentToSeller, address(vault));
        FHE.allowTransient(feeAmount, address(vault));
        FHE.allow(feeAmount, address(vault));

        // Transfer auctioned tokens: seller → winner
        vault.settleTrade(auction.seller, winner, auction.token, auctionAmount);

        // Transfer payment: winner → seller (minus fee)
        vault.settleTrade(winner, auction.seller, auction.paymentToken, paymentToSeller);

        // Transfer fee: winner → fee collector
        if (fee > 0) {
            vault.settleTrade(winner, registry.feeCollector(), auction.paymentToken, feeAmount);
        }

        // Mint Claim NFT to winner
        if (address(claimNFT) != address(0)) {
            claimNFT.mint(winner, address(this), auctionId, "AUCTION");
        }

        auction.status = AuctionStatus.SETTLED;

        bytes32 salt = keccak256(abi.encodePacked(block.number, block.prevrandao));
        emit TradeCompleted(
            keccak256(abi.encodePacked(auction.seller, salt)),
            keccak256(abi.encodePacked(winner, salt)),
            auctionId
        );
        emit AuctionSettled(auctionId);
    }

    /// @notice Cancel auction if no bids placed (seller only)
    function cancelAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert Unauthorized();
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (auction.bidCount != 0) revert InvalidState();

        auction.status = AuctionStatus.CANCELLED;
        emit AuctionCancelled(auctionId);
    }

    /// @notice Bidder views their own bid handle (for unsealing)
    function getMyBid(uint256 auctionId) external view returns (euint128) {
        if (!hasBid[auctionId][msg.sender]) revert InvalidState();
        return bids[auctionId][msg.sender];
    }

    /// @notice Get auction details (preserves original tuple shape for frontend compat)
    function getAuction(uint256 auctionId) external view returns (
        address seller,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 deadline,
        uint256 bidCount,
        AuctionStatus status,
        uint128 revealedBid,
        address revealedBidder
    ) {
        Auction storage a = auctions[auctionId];
        return (a.seller, a.token, a.paymentToken, a.amount, a.deadline,
                a.bidCount, a.status, a.revealedBid, a.revealedBidder);
    }

    /// @notice Blind Floor view: returns whether this is a blind auction and (post-reveal)
    ///         whether the reserve was met. Encrypted reserve handle stays sealed forever.
    function getBlindStatus(uint256 auctionId) external view returns (
        bool hasReserve,
        bool revealedReserveMet,
        euint64 encReserveMetHandle
    ) {
        Auction storage a = auctions[auctionId];
        return (a.hasReserve, a.revealedReserveMet, a.encReserveMet);
    }

    /// @notice Check if any auctions exist
    function hasAuctions() external view returns (bool) {
        return nextAuctionId > 0;
    }

    /// @notice Total auctions ever created (audit fix: frontend ABI expected this)
    function getAuctionCount() external view returns (uint256) {
        return nextAuctionId;
    }
}
