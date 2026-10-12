// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, eaddress, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

interface IAuctionClaimVA {
    function mint(address winner, address sourceContract, uint256 sourceId, string calldata claimType) external returns (uint256);
}

/// @title VickreyAuction — Second-price sealed-bid auction with FHE
/// @notice Highest bidder wins but pays the SECOND-highest bid price.
///         Incentivizes truthful bidding — your dominant strategy is to bid your true value.
///         Both highest and second-highest bids tracked on ciphertext simultaneously.
/// @dev FHE ops per bid: gt(1), select(4), max(1), allowThis(4), allow(1) = 11 ops
///      Tracks: highestBid, highestBidder, secondBid — all encrypted until reveal.
///      Winner pays secondBid, not their own bid. Classic Vickrey game theory.
contract VickreyAuction is ReentrancyGuard, FHEConstants {
    enum AuctionStatus { OPEN, CLOSED, REVEALED, SETTLED, CANCELLED }

    struct Auction {
        address seller;
        address token;
        address paymentToken;
        uint256 amount;
        uint256 deadline;
        uint256 bidCount;
        euint128 highestBid;
        eaddress highestBidder;
        euint128 secondBid;       // Second-highest bid — THIS is what winner pays
        uint128 revealedHighest;
        uint128 revealedSecond;   // Winner's actual payment
        address revealedBidder;
        AuctionStatus status;
        uint256 snipeExtension;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    IAuctionClaimVA public claimNFT;

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => euint128)) private bids;
    mapping(uint256 => mapping(address => bool)) public hasBid;
    uint256 public nextAuctionId;

    uint256 public constant DEFAULT_SNIPE_WINDOW = 60;
    uint256 public constant DEFAULT_SNIPE_EXTENSION = 120;
    uint256 public constant MIN_DURATION = 300;
    uint256 public constant PLATFORM_FEE_BPS = 200;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address token, uint256 amount, uint256 deadline);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 newDeadline);
    event AuctionClosed(uint256 indexed auctionId);
    event WinnerRevealed(uint256 indexed auctionId, address winner, uint128 winningBid, uint128 pricePaid);
    event AuctionSettled(uint256 indexed auctionId);
    event AuctionCancelled(uint256 indexed auctionId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry, address _claimNFT) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        if (_claimNFT != address(0)) claimNFT = IAuctionClaimVA(_claimNFT);
        _initFHEConstants();
    }

    /// @notice Create a Vickrey (second-price) auction
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

        euint128 initBid = FHE.asEuint128(0);
        eaddress initBidder = FHE.asEaddress(address(0));
        euint128 initSecond = FHE.asEuint128(0);
        FHE.allowThis(initBid);
        FHE.allowThis(initBidder);
        FHE.allowThis(initSecond);

        auctions[auctionId] = Auction({
            seller: msg.sender,
            token: token,
            paymentToken: paymentToken,
            amount: amount,
            deadline: deadline,
            bidCount: 0,
            highestBid: initBid,
            highestBidder: initBidder,
            secondBid: initSecond,
            revealedHighest: 0,
            revealedSecond: 0,
            revealedBidder: address(0),
            status: AuctionStatus.OPEN,
            snipeExtension: ext
        });

        emit AuctionCreated(auctionId, msg.sender, token, amount, deadline);
    }

    /// @notice Submit encrypted bid — tracks BOTH highest and second-highest on ciphertext
    /// @dev The key Vickrey logic: when a new bid beats the current highest,
    ///      the OLD highest becomes the new second. When a new bid is between
    ///      highest and second, it becomes the new second. All via FHE.select.
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

        // Is new bid higher than current highest?
        ebool isNewHighest = FHE.gt(newBid, auction.highestBid);

        // Is new bid higher than current second? (but not highest)
        ebool isAboveSecond = FHE.gt(newBid, auction.secondBid);

        // Update second-highest bid:
        // If new bid is the new highest → old highest becomes second
        // If new bid is between highest and second → new bid becomes second
        // If new bid is below second → second stays the same
        euint128 newSecond = FHE.select(
            isNewHighest,
            auction.highestBid,                              // old highest → new second
            FHE.select(isAboveSecond, newBid, auction.secondBid) // new bid or keep old second
        );

        // Update highest bid and bidder
        euint128 newHighest = FHE.select(isNewHighest, newBid, auction.highestBid);
        eaddress newHighestBidder = FHE.select(
            isNewHighest,
            FHE.asEaddress(msg.sender),
            auction.highestBidder
        );

        auction.highestBid = newHighest;
        auction.highestBidder = newHighestBidder;
        auction.secondBid = newSecond;

        FHE.allowThis(auction.highestBid);
        FHE.allowThis(auction.highestBidder);
        FHE.allowThis(auction.secondBid);

        // Store individual bid for unsealing
        bids[auctionId][msg.sender] = newBid;
        FHE.allowThis(newBid);
        FHE.allowSender(newBid);

        hasBid[auctionId][msg.sender] = true;
        auction.bidCount++;

        // Anti-snipe
        uint256 newDeadline = auction.deadline;
        if (block.timestamp > auction.deadline - DEFAULT_SNIPE_WINDOW) {
            newDeadline = block.timestamp + auction.snipeExtension;
            auction.deadline = newDeadline;
        }

        emit BidPlaced(auctionId, msg.sender, newDeadline);
    }

    /// @notice Close auction and mark winner data publicly decryptable.
    /// @dev Off-chain, anyone calls client.decryptForTx() on each handle to obtain
    ///      (value, signature) triples that revealWinner verifies on-chain.
    function closeAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert Unauthorized();
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp < auction.deadline) revert InvalidState();
        if (auction.bidCount == 0) revert InvalidState();

        FHE.allowGlobal(auction.highestBid);
        FHE.allowGlobal(auction.secondBid);
        FHE.allowGlobal(auction.highestBidder);

        auction.status = AuctionStatus.CLOSED;
        emit AuctionClosed(auctionId);
    }

    /// @notice Publish the verified Vickrey reveal: winner, winning bid, price paid (2nd-highest).
    function revealWinner(
        uint256 auctionId,
        uint128 highest,
        bytes calldata highestSignature,
        uint128 second,
        bytes calldata secondSignature,
        address bidder,
        bytes calldata bidderSignature
    )
        external
        returns (uint128 winningBid, uint128 pricePaid, address winner)
    {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.CLOSED) revert InvalidState();

        FHE.publishDecryptResult(auction.highestBid, highest, highestSignature);
        FHE.publishDecryptResult(auction.secondBid, second, secondSignature);
        FHE.publishDecryptResult(auction.highestBidder, bidder, bidderSignature);

        // Audit fix C-VA1: previously only handled single-bidder case. With
        // multiple bidders, if only one had a positive bid (others bid zero),
        // second would be 0 and the winner would pay 0. That breaks the
        // Vickrey mechanism's incentive guarantee.
        //
        // New rule: if second == 0 for ANY reason, fall back to first-price
        // (winner pays their own bid). This preserves auction integrity.
        if (second == 0) {
            second = highest;
        }

        auction.revealedHighest = highest;
        auction.revealedSecond = second;
        auction.revealedBidder = bidder;
        auction.status = AuctionStatus.REVEALED;

        emit WinnerRevealed(auctionId, bidder, highest, second);
        return (highest, second, bidder);
    }

    /// @notice Settle — winner pays SECOND-highest price (Vickrey mechanism)
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.REVEALED) revert InvalidState();

        address winner = auction.revealedBidder;
        if (winner == address(0)) revert InvalidState();

        // Winner pays the SECOND-highest bid, not their own
        uint256 pricePaid = uint256(auction.revealedSecond);
        uint256 fee = (pricePaid * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerReceives = pricePaid - fee;

        euint64 auctionAmount = FHE.asEuint64(uint64(auction.amount));
        euint64 paymentToSeller = FHE.asEuint64(uint64(sellerReceives));
        euint64 feeAmount = FHE.asEuint64(uint64(fee));

        FHE.allowThis(auctionAmount);
        FHE.allowThis(paymentToSeller);
        FHE.allowThis(feeAmount);
        FHE.allowTransient(auctionAmount, address(vault));
        FHE.allow(auctionAmount, address(vault));
        FHE.allowTransient(paymentToSeller, address(vault));
        FHE.allow(paymentToSeller, address(vault));
        FHE.allowTransient(feeAmount, address(vault));
        FHE.allow(feeAmount, address(vault));

        // Tokens: seller → winner
        vault.settleTrade(auction.seller, winner, auction.token, auctionAmount);

        // Payment: winner → seller (at SECOND price, not their bid)
        vault.settleTrade(winner, auction.seller, auction.paymentToken, paymentToSeller);

        // Fee: winner → fee collector
        if (fee > 0) {
            vault.settleTrade(winner, registry.feeCollector(), auction.paymentToken, feeAmount);
        }

        // Mint Claim NFT
        if (address(claimNFT) != address(0)) {
            claimNFT.mint(winner, address(this), auctionId, "VICKREY");
        }

        auction.status = AuctionStatus.SETTLED;
        emit AuctionSettled(auctionId);
    }

    /// @notice Cancel if no bids
    function cancelAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert Unauthorized();
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (auction.bidCount != 0) revert InvalidState();

        auction.status = AuctionStatus.CANCELLED;
        emit AuctionCancelled(auctionId);
    }

    /// @notice Bidder views their own bid handle
    function getMyBid(uint256 auctionId) external view returns (euint128) {
        if (!hasBid[auctionId][msg.sender]) revert InvalidState();
        return bids[auctionId][msg.sender];
    }

    /// @notice Get auction details
    function getAuction(uint256 auctionId) external view returns (
        address seller, address token, address paymentToken,
        uint256 amount, uint256 deadline, uint256 bidCount,
        AuctionStatus status, uint128 revealedHighest,
        uint128 revealedSecond, address revealedBidder
    ) {
        Auction storage a = auctions[auctionId];
        return (a.seller, a.token, a.paymentToken, a.amount, a.deadline,
                a.bidCount, a.status, a.revealedHighest,
                a.revealedSecond, a.revealedBidder);
    }

    function hasAuctions() external view returns (bool) {
        return nextAuctionId > 0;
    }

    function getAuctionCount() external view returns (uint256) {
        return nextAuctionId;
    }
}
