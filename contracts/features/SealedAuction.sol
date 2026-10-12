// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, externalEuint64, eaddress, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

interface IAuctionClaim {
    function mint(address winner, address sourceContract, uint256 sourceId, string calldata claimType) external returns (uint256);
}

/// @title SealedAuction — escrowed sealed-bid block sales
/// @notice A seller sells a public lot to the highest sealed bid. Every bid locks the
///         bidder's funds in the vault, and the lot is locked from the seller, so the
///         sale settles atomically from escrow: the winner always pays exactly the
///         winning bid and always receives the lot. Losing bids are refunded as
///         ciphertext and are never decrypted — not at close, not after.
/// @notice BLIND FLOOR (createBlindAuction): the seller's reserve is encrypted and is
///         never decrypted. At close the contract publishes only whether the sale went
///         through; if the reserve wasn't met, neither the reserve nor any bid is revealed.
/// @dev Lifecycle:
///      createAuction → PENDING_LOT ──confirmLot──▶ OPEN (lot locked) or CANCELLED (unfunded)
///      OPEN ──bids──▶ deadline ──closeAuction (anyone)──▶ CLOSED
///      CLOSED ──reveal (anyone, TN-signed)──▶ REVEALED (sale) or NO_SALE (reserve not met)
///      REVEALED ──settleAuction (anyone)──▶ SETTLED
///      Losers (and everyone on NO_SALE) pull refunds with claimRefund.
contract SealedAuction is ReentrancyGuard, FHEConstants {
    // Order kept compatible with v1 indices 0–5 for the frontend.
    enum AuctionStatus { OPEN, CLOSED, REVEALED, SETTLED, CANCELLED, NO_SALE, PENDING_LOT }

    struct Auction {
        address seller;
        address token;           // Token being sold (the lot)
        address paymentToken;    // Token bidders pay with
        uint256 amount;          // Plaintext lot size (public for discoverability)
        uint256 duration;        // Bidding window, starts when the lot is confirmed
        uint256 deadline;        // Plaintext public deadline (0 until OPEN)
        uint256 bidCount;        // Plaintext number of bids (never amounts)
        euint64 highestBid;      // ENCRYPTED: highest amount actually locked
        eaddress highestBidder;  // ENCRYPTED
        euint64 lotLocked;       // ENCRYPTED: lot locked from the seller (full or 0)
        ebool lotFunded;         // ENCRYPTED until confirmLot publishes it
        euint64 encWinningBid;   // Set at close: winning bid if the sale goes through, else 0
        eaddress encWinner;      // Set at close: winner if the sale goes through, else 0x0
        ebool encSaleOk;         // Set at close: true unless a Blind Floor reserve wasn't met
        uint64 revealedBid;
        address revealedBidder;
        AuctionStatus status;
        uint256 snipeExtension;
        bool hasReserve;
        euint64 encReserve;      // Blind Floor: NEVER decrypted
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    IAuctionClaim public claimNFT;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%
    uint256 public constant DEFAULT_SNIPE_WINDOW = 60;     // last 60 seconds
    uint256 public constant DEFAULT_SNIPE_EXTENSION = 120; // extend by 2 minutes
    uint256 public constant MAX_SNIPE_EXTENSION = 1 hours;
    uint256 public constant MIN_DURATION = 300;            // 5 minutes
    uint256 public constant MAX_DURATION = 90 days;

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => euint64)) private bids; // amount actually locked
    mapping(uint256 => mapping(address => bool)) public hasBid;
    mapping(uint256 => mapping(address => bool)) public refunded;
    uint256 public nextAuctionId;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();
    error InvalidDecryptSignature();

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address token, uint256 amount, uint256 duration);
    event LotConfirmed(uint256 indexed auctionId, bool funded, uint256 deadline);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 newDeadline);
    event AuctionClosed(uint256 indexed auctionId);
    event WinnerRevealed(uint256 indexed auctionId, address winner, uint64 winningBid);
    event NoSale(uint256 indexed auctionId);
    event AuctionSettled(uint256 indexed auctionId);
    event AuctionCancelled(uint256 indexed auctionId);
    event RefundClaimed(uint256 indexed auctionId, address indexed bidder);

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
    }

    // ─── Create ────────────────────────────────────────────

    /// @notice Create a sealed-bid auction. The lot is locked from the seller's vault
    ///         balance now; bidding opens once confirmLot proves it was fully locked.
    function createAuction(
        address token,
        address paymentToken,
        uint256 amount,
        uint256 duration,
        uint256 snipeExtension
    ) external whenNotPaused nonReentrant returns (uint256 auctionId) {
        auctionId = _create(token, paymentToken, amount, duration, snipeExtension);
    }

    /// @notice Create a Blind Floor auction with an encrypted reserve that never decrypts.
    function createBlindAuction(
        address token,
        address paymentToken,
        uint256 amount,
        uint256 duration,
        uint256 snipeExtension,
        externalEuint64 encReserve,
        bytes calldata reserveProof
    ) external whenNotPaused nonReentrant returns (uint256 auctionId) {
        auctionId = _create(token, paymentToken, amount, duration, snipeExtension);
        Auction storage a = auctions[auctionId];
        euint64 reserve = FHE.asEuint64(encReserve, reserveProof);
        FHE.allowThis(reserve); // never made public — sealed forever
        a.hasReserve = true;
        a.encReserve = reserve;
    }

    function _create(
        address token,
        address paymentToken,
        uint256 amount,
        uint256 duration,
        uint256 snipeExtension
    ) internal returns (uint256 auctionId) {
        if (token == paymentToken) revert InvalidInput();
        if (amount == 0 || amount > type(uint64).max) revert InvalidInput();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidInput();
        if (snipeExtension > MAX_SNIPE_EXTENSION) revert InvalidInput();

        auctionId = nextAuctionId++;
        Auction storage a = auctions[auctionId];
        a.seller = msg.sender;
        a.token = token;
        a.paymentToken = paymentToken;
        a.amount = amount;
        a.duration = duration;
        a.snipeExtension = snipeExtension > 0 ? snipeExtension : DEFAULT_SNIPE_EXTENSION;
        a.status = AuctionStatus.PENDING_LOT;

        // Lock the lot from the seller. The vault locks the full lot or nothing.
        euint64 lot = FHE.asEuint64(uint64(amount));
        euint64 locked = _lock(msg.sender, token, lot);
        FHE.allowThis(locked);
        a.lotLocked = locked;

        // Whether the seller actually had the lot is published before bidding opens,
        // so bidders never lock funds against an unfunded sale.
        ebool funded = FHE.eq(locked, lot);
        FHE.allowThis(funded);
        FHE.allowPublic(funded);
        a.lotFunded = funded;

        a.highestBid = ZERO_64;
        a.highestBidder = FHE.asEaddress(address(0));
        FHE.allowThis(a.highestBidder);

        emit AuctionCreated(auctionId, msg.sender, token, amount, duration);
    }

    /// @notice Publish whether the lot was locked (TN-signed). Anyone can call.
    ///         Funded → bidding opens for `duration`. Unfunded → cancelled.
    function confirmLot(uint256 auctionId, bool funded, bytes calldata signature) external whenNotPaused {
        Auction storage a = auctions[auctionId];
        if (a.seller == address(0)) revert InvalidInput();
        if (a.status != AuctionStatus.PENDING_LOT) revert InvalidState();

        // verifyDecryptResult (not publish): we store the outcome ourselves, so
        // the PlaintextsStorage write would only cost gas.
        if (!FHE.verifyDecryptResult(a.lotFunded, funded, signature)) revert InvalidDecryptSignature();

        if (funded) {
            a.deadline = block.timestamp + a.duration;
            a.status = AuctionStatus.OPEN;
        } else {
            a.status = AuctionStatus.CANCELLED; // nothing was locked
        }
        emit LotConfirmed(auctionId, funded, a.deadline);
    }

    // ─── Bid ───────────────────────────────────────────────

    /// @notice Place an encrypted bid. The bid amount is locked from the bidder's vault
    ///         balance; if the balance can't cover it, 0 is locked and the bid can't win.
    ///         The bidder can unseal their own bid to see what was actually locked.
    function bid(uint256 auctionId, externalEuint64 encBidAmount, bytes calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        Auction storage a = auctions[auctionId];
        if (a.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp >= a.deadline) revert Expired();
        if (a.seller == msg.sender) revert InvalidInput();
        if (hasBid[auctionId][msg.sender]) revert InvalidState();

        euint64 requested = FHE.asEuint64(encBidAmount, proof);
        euint64 locked = _lock(msg.sender, a.paymentToken, requested);

        // Compare what was actually locked, never the raw request.
        ebool isHigher = FHE.gt(locked, a.highestBid);
        a.highestBid = FHE.max(locked, a.highestBid);
        a.highestBidder = FHE.select(isHigher, FHE.asEaddress(msg.sender), a.highestBidder);
        FHE.allowThis(a.highestBid);
        FHE.allowThis(a.highestBidder);

        bids[auctionId][msg.sender] = locked;
        FHE.allowThis(locked);
        FHE.allowSender(locked);

        hasBid[auctionId][msg.sender] = true;
        a.bidCount++;

        // Anti-snipe: a late bid extends the deadline (reveals that a bid happened, not its size)
        if (block.timestamp > a.deadline - DEFAULT_SNIPE_WINDOW) {
            a.deadline = block.timestamp + a.snipeExtension;
        }

        emit BidPlaced(auctionId, msg.sender, a.deadline);
    }

    // ─── Close & reveal ────────────────────────────────────

    /// @notice Close an auction after its deadline. Anyone can call, so a seller can't
    ///         stall a finished auction. With no bids, the lot is returned and it's cancelled.
    function closeAuction(uint256 auctionId) external whenNotPaused nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp < a.deadline) revert InvalidState();

        if (a.bidCount == 0) {
            a.status = AuctionStatus.CANCELLED;
            _release(a.seller, a.token, a.lotLocked);
            emit AuctionCancelled(auctionId);
            return;
        }

        // A sale goes through unless a Blind Floor reserve wasn't met. If it doesn't,
        // the published winner and bid are zeroed, so nothing about any bid leaks.
        ebool ok = a.hasReserve ? FHE.gte(a.highestBid, a.encReserve) : FHE.asEbool(true);
        a.encSaleOk = ok;
        a.encWinningBid = FHE.select(ok, a.highestBid, ZERO_64);
        a.encWinner = FHE.select(ok, a.highestBidder, FHE.asEaddress(address(0)));

        FHE.allowThis(a.encSaleOk);
        FHE.allowThis(a.encWinningBid);
        FHE.allowThis(a.encWinner);
        FHE.allowPublic(a.encSaleOk);
        FHE.allowPublic(a.encWinningBid);
        FHE.allowPublic(a.encWinner);

        a.status = AuctionStatus.CLOSED;
        emit AuctionClosed(auctionId);
    }

    /// @notice Publish the TN-signed outcome. Anyone can call.
    /// @dev Caller gets (value, signature) for each handle from getRevealHandles via
    ///      the cofhe sdk: client.decryptForTx(handle).withoutACP().execute().
    function reveal(
        uint256 auctionId,
        bool saleOk,
        bytes calldata saleOkSignature,
        uint64 bidValue,
        bytes calldata bidSignature,
        address bidderValue,
        bytes calldata bidderSignature
    ) external whenNotPaused nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.status != AuctionStatus.CLOSED) revert InvalidState();

        if (
            !FHE.verifyDecryptResult(a.encSaleOk, saleOk, saleOkSignature) ||
            !FHE.verifyDecryptResult(a.encWinningBid, bidValue, bidSignature) ||
            !FHE.verifyDecryptResult(a.encWinner, bidderValue, bidderSignature)
        ) revert InvalidDecryptSignature();

        if (!saleOk) {
            a.status = AuctionStatus.NO_SALE;
            _release(a.seller, a.token, a.lotLocked);
            emit NoSale(auctionId);
            return;
        }

        a.revealedBid = bidValue;
        a.revealedBidder = bidderValue;
        a.status = AuctionStatus.REVEALED;
        emit WinnerRevealed(auctionId, bidderValue, bidValue);
    }

    // ─── Settle & refunds ──────────────────────────────────

    /// @notice Settle from escrow. Anyone can call. The winner's locked bid pays the
    ///         seller (minus the platform fee) and the locked lot goes to the winner.
    function settleAuction(uint256 auctionId) external whenNotPaused nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.status != AuctionStatus.REVEALED) revert InvalidState();
        address winner = a.revealedBidder;
        if (winner == address(0)) revert InvalidState();

        a.status = AuctionStatus.SETTLED;
        refunded[auctionId][winner] = true; // the winner's escrow is spent below

        uint256 fee = (uint256(a.revealedBid) * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerReceives = uint256(a.revealedBid) - fee;

        _release(winner, a.token, a.lotLocked);
        _release(a.seller, a.paymentToken, _plain(sellerReceives));
        if (fee > 0) {
            _release(registry.feeCollector(), a.paymentToken, _plain(fee));
        }

        if (address(claimNFT) != address(0)) {
            claimNFT.mint(winner, address(this), auctionId, "AUCTION");
        }

        emit AuctionSettled(auctionId);
    }

    /// @notice Return a non-winning bidder's locked funds, as ciphertext. The amount is
    ///         never decrypted. Available after settlement, or after a no-sale.
    function claimRefund(uint256 auctionId) external whenNotPaused nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.status != AuctionStatus.SETTLED && a.status != AuctionStatus.NO_SALE) revert InvalidState();
        if (!hasBid[auctionId][msg.sender]) revert Unauthorized();
        if (refunded[auctionId][msg.sender]) revert InvalidState();

        refunded[auctionId][msg.sender] = true;
        _release(msg.sender, a.paymentToken, bids[auctionId][msg.sender]);
        emit RefundClaimed(auctionId, msg.sender);
    }

    /// @notice Seller cancels before any bids. The lot (if it was locked) is returned.
    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.seller != msg.sender) revert Unauthorized();
        if (a.status != AuctionStatus.OPEN && a.status != AuctionStatus.PENDING_LOT) revert InvalidState();
        if (a.bidCount != 0) revert InvalidState();

        a.status = AuctionStatus.CANCELLED;
        _release(a.seller, a.token, a.lotLocked);
        emit AuctionCancelled(auctionId);
    }

    function _plain(uint256 value) internal returns (euint64 v) {
        v = FHE.asEuint64(uint64(value));
        FHE.allowThis(v);
    }

    function _lock(address user, address token, euint64 amount) internal returns (euint64) {
        return FHE.receiveEuint64FromCall(
            vault.lockFunds(user, token, FHE.shareEuint64(amount, address(vault))),
            address(vault)
        );
    }

    function _release(address to, address token, euint64 amount) internal {
        vault.releaseFunds(to, token, FHE.shareEuint64(amount, address(vault)));
    }

    // ─── Views ─────────────────────────────────────────────

    /// @notice Bidder's own bid handle: the amount actually locked (unseal with a permit)
    function getMyBid(uint256 auctionId) external view returns (euint64) {
        if (!hasBid[auctionId][msg.sender]) revert InvalidState();
        return bids[auctionId][msg.sender];
    }

    /// @notice Handle to decrypt (publicly) and pass to confirmLot
    function getLotFundedHandle(uint256 auctionId) external view returns (ebool) {
        return auctions[auctionId].lotFunded;
    }

    /// @notice Handles to decrypt (publicly) and pass to reveal, in reveal()'s order
    function getRevealHandles(uint256 auctionId) external view returns (ebool saleOk, euint64 winningBid, eaddress winner) {
        Auction storage a = auctions[auctionId];
        return (a.encSaleOk, a.encWinningBid, a.encWinner);
    }

    /// @notice Auction summary (same tuple shape as v1 for frontend compatibility)
    function getAuction(uint256 auctionId) external view returns (
        address seller,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 deadline,
        uint256 bidCount,
        AuctionStatus status,
        uint64 revealedBid,
        address revealedBidder
    ) {
        Auction storage a = auctions[auctionId];
        return (a.seller, a.token, a.paymentToken, a.amount, a.deadline,
                a.bidCount, a.status, a.revealedBid, a.revealedBidder);
    }

    /// @notice Blind Floor view. The reserve's handle is readable from auctions(), but
    ///         it is never made decryptable, so nobody can learn the reserve.
    function getBlindStatus(uint256 auctionId) external view returns (
        bool hasReserve,
        bool revealedReserveMet,
        ebool encSaleOkHandle
    ) {
        Auction storage a = auctions[auctionId];
        bool met = a.status == AuctionStatus.REVEALED || a.status == AuctionStatus.SETTLED;
        return (a.hasReserve, a.hasReserve && met, a.encSaleOk);
    }

    function hasAuctions() external view returns (bool) {
        return nextAuctionId > 0;
    }

    function getAuctionCount() external view returns (uint256) {
        return nextAuctionId;
    }
}
