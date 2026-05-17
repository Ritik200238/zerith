// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

interface IAuctionClaimDA {
    function mint(address winner, address sourceContract, uint256 sourceId, string calldata claimType) external returns (uint256);
}

/// @title DutchAuction — Descending price auction with encrypted bid amounts
/// @notice Price starts high and decays linearly over time. Bidders accept at their
///         preferred price by submitting encrypted purchase amounts. First to fill the
///         supply wins at the current decayed price. Remaining supply available to later bidders.
/// @dev Price decay is plaintext (public — buyers need to see current price).
///      Purchase AMOUNTS are encrypted (private — nobody sees how much you're buying).
contract DutchAuction is ReentrancyGuard, FHEConstants {
    enum AuctionStatus { OPEN, SETTLED, CANCELLED }

    struct Auction {
        address seller;
        address token;
        address paymentToken;
        uint256 totalSupply;
        uint256 startPrice;       // Price at auction start (per token, in payment token units)
        uint256 endPrice;         // Floor price (minimum — price won't go below this)
        uint256 startTime;
        uint256 endTime;
        uint256 filledAmount;     // How much supply has been bought (plaintext — public)
        AuctionStatus status;
    }

    struct Purchase {
        address buyer;
        uint256 priceAtPurchase;  // Price when they bought (plaintext — locked at time of buy)
        euint64 encAmount;        // How many tokens they bought (encrypted)
        bool claimed;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    IAuctionClaimDA public claimNFT;

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => Purchase[]) public purchases;
    uint256 public nextAuctionId;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%
    uint256 public constant MIN_DURATION = 300;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    event DutchAuctionCreated(uint256 indexed auctionId, address indexed seller, uint256 startPrice, uint256 endPrice, uint256 endTime);
    event DutchPurchase(uint256 indexed auctionId, address indexed buyer, uint256 pricePerToken);
    event DutchAuctionSettled(uint256 indexed auctionId, uint256 totalFilled);
    event DutchAuctionCancelled(uint256 indexed auctionId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry, address _claimNFT) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        if (_claimNFT != address(0)) claimNFT = IAuctionClaimDA(_claimNFT);
        _initFHEConstants();
    }

    /// @notice Get current price based on linear decay
    function getCurrentPrice(uint256 auctionId) public view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (block.timestamp >= auction.endTime) return auction.endPrice;
        if (block.timestamp <= auction.startTime) return auction.startPrice;

        uint256 elapsed = block.timestamp - auction.startTime;
        uint256 duration = auction.endTime - auction.startTime;
        uint256 priceDrop = ((auction.startPrice - auction.endPrice) * elapsed) / duration;
        return auction.startPrice - priceDrop;
    }

    /// @notice Seller creates a Dutch auction
    function createAuction(
        address token,
        address paymentToken,
        uint256 totalSupply,
        uint256 startPrice,
        uint256 endPrice,
        uint256 duration
    ) external whenNotPaused returns (uint256 auctionId) {
        if (token == paymentToken) revert InvalidInput();
        if (totalSupply == 0 || startPrice == 0) revert InvalidInput();
        if (endPrice >= startPrice) revert InvalidInput();
        if (duration < MIN_DURATION) revert InvalidInput();

        auctionId = nextAuctionId++;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            token: token,
            paymentToken: paymentToken,
            totalSupply: totalSupply,
            startPrice: startPrice,
            endPrice: endPrice,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            filledAmount: 0,
            status: AuctionStatus.OPEN
        });

        emit DutchAuctionCreated(auctionId, msg.sender, startPrice, endPrice, block.timestamp + duration);
    }

    /// @notice Buy tokens at current decayed price with encrypted amount
    /// @dev Amount is encrypted — nobody sees how much you're buying.
    ///      Price is plaintext (current decay level is public).
    ///      Payment = amount × currentPrice (computed via FHE.mul on encrypted amount × plaintext price).
    function buy(uint256 auctionId, InEuint64 calldata encAmount) external whenNotPaused nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp >= auction.endTime) revert InvalidState();
        if (auction.seller == msg.sender) revert InvalidInput();
        if (auction.filledAmount >= auction.totalSupply) revert InvalidState();

        uint256 currentPrice = getCurrentPrice(auctionId);
        euint64 amount = FHE.asEuint64(encAmount);

        // Cap at remaining supply
        uint256 remaining = auction.totalSupply - auction.filledAmount;
        euint64 cappedAmount = FHE.min(amount, FHE.asEuint64(uint64(remaining)));

        FHE.allowThis(cappedAmount);
        FHE.allowSender(cappedAmount);

        purchases[auctionId].push(Purchase({
            buyer: msg.sender,
            priceAtPurchase: currentPrice,
            encAmount: cappedAmount,
            claimed: false
        }));

        emit DutchPurchase(auctionId, msg.sender, currentPrice);
    }

    /// @notice Settle auction after end time or fully filled
    function settleAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (block.timestamp < auction.endTime && auction.filledAmount < auction.totalSupply) revert InvalidState();

        auction.status = AuctionStatus.SETTLED;
        emit DutchAuctionSettled(auctionId, auction.filledAmount);
    }

    /// @notice Buyer initiates claim by marking their purchase amount publicly decryptable.
    /// @dev Buyer then calls client.decryptForTx() off-chain to obtain (amount, signature)
    ///      and submits it via finalizeClaim. Only the buyer can initiate this for their purchase.
    function claimPurchase(uint256 auctionId, uint256 purchaseIndex) external nonReentrant {
        Purchase storage purchase = purchases[auctionId][purchaseIndex];
        if (purchase.buyer != msg.sender) revert Unauthorized();
        if (purchase.claimed) revert InvalidState();

        FHE.allowGlobal(purchase.encAmount);
    }

    /// @notice Finalize claim with the verified decryption signature.
    function finalizeClaim(
        uint256 auctionId,
        uint256 purchaseIndex,
        uint64 amount,
        bytes calldata signature
    ) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        Purchase storage purchase = purchases[auctionId][purchaseIndex];
        if (purchase.buyer != msg.sender) revert Unauthorized();
        if (purchase.claimed) revert InvalidState();

        FHE.publishDecryptResult(purchase.encAmount, amount, signature);

        // Cap at remaining supply
        uint256 remaining = auction.totalSupply - auction.filledAmount;
        uint64 actualAmount = amount > uint64(remaining) ? uint64(remaining) : amount;

        if (actualAmount == 0) {
            purchase.claimed = true;
            return;
        }

        // Compute payment in plaintext (price was locked at purchase time)
        uint256 totalPayment = uint256(actualAmount) * purchase.priceAtPurchase;
        uint256 fee = (totalPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerReceives = totalPayment - fee;

        // Settle via vault: tokens seller → buyer, payment buyer → seller
        euint64 tokenAmount = FHE.asEuint64(actualAmount);
        euint64 paymentAmount = FHE.asEuint64(uint64(sellerReceives));
        euint64 feeAmount = FHE.asEuint64(uint64(fee));

        FHE.allowThis(tokenAmount);
        FHE.allowThis(paymentAmount);
        FHE.allowThis(feeAmount);
        FHE.allowTransient(tokenAmount, address(vault));
        FHE.allow(tokenAmount, address(vault));
        FHE.allowTransient(paymentAmount, address(vault));
        FHE.allow(paymentAmount, address(vault));
        FHE.allowTransient(feeAmount, address(vault));
        FHE.allow(feeAmount, address(vault));

        vault.settleTrade(auction.seller, msg.sender, auction.token, tokenAmount);
        vault.settleTrade(msg.sender, auction.seller, auction.paymentToken, paymentAmount);
        if (fee > 0) {
            vault.settleTrade(msg.sender, registry.feeCollector(), auction.paymentToken, feeAmount);
        }

        auction.filledAmount += actualAmount;
        purchase.claimed = true;

        if (address(claimNFT) != address(0)) {
            claimNFT.mint(msg.sender, address(this), auctionId, "DUTCH");
        }
    }

    /// @notice Cancel if no purchases made
    function cancelAuction(uint256 auctionId) external {
        Auction storage auction = auctions[auctionId];
        if (auction.seller != msg.sender) revert Unauthorized();
        if (auction.status != AuctionStatus.OPEN) revert InvalidState();
        if (purchases[auctionId].length > 0) revert InvalidState();

        auction.status = AuctionStatus.CANCELLED;
        emit DutchAuctionCancelled(auctionId);
    }

    function getAuction(uint256 auctionId) external view returns (
        address seller, address token, address paymentToken,
        uint256 totalSupply, uint256 startPrice, uint256 endPrice,
        uint256 startTime, uint256 endTime, uint256 filledAmount,
        AuctionStatus status, uint256 currentPrice
    ) {
        Auction storage a = auctions[auctionId];
        return (a.seller, a.token, a.paymentToken, a.totalSupply,
                a.startPrice, a.endPrice, a.startTime, a.endTime,
                a.filledAmount, a.status, getCurrentPrice(auctionId));
    }

    function getPurchaseCount(uint256 auctionId) external view returns (uint256) {
        return purchases[auctionId].length;
    }

    function getAuctionCount() external view returns (uint256) {
        return nextAuctionId;
    }

    function hasAuctions() external view returns (bool) {
        return nextAuctionId > 0;
    }
}
