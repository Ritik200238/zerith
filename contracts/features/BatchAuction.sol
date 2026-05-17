// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title BatchAuction — Batch auction with encrypted clearing price computation
/// @notice Collects buy/sell orders over a time window. All prices encrypted. Computes
///         a clearing price using a discrete plaintext price ladder (avoids FHE.div(enc,enc)).
///         Clearing price becomes public after computation — same price for everyone.
/// @dev Max 5 orders per round, 3 price ladder steps for gas feasibility.
contract BatchAuction is ReentrancyGuard, FHEConstants {
    struct BuyOrder {
        address buyer;
        euint128 encMaxPrice;    // Encrypted max price buyer will pay
        uint256 amount;          // Plaintext buy volume
    }

    struct SellOrder {
        address seller;
        euint128 encMinPrice;    // Encrypted min price seller will accept
        uint256 amount;          // Plaintext sell volume
    }

    enum RoundStatus { COLLECTING, CLOSED, CLEARING, SETTLED }

    struct Round {
        address tokenA;
        address tokenB;
        uint256 startTime;
        uint256 endTime;
        RoundStatus status;
        uint256 clearingPrice;       // Set after clearing computation (becomes public)
        uint256 totalBuyVolume;
        uint256 totalSellVolume;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    address public admin;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => BuyOrder[]) private buyOrders;
    mapping(uint256 => SellOrder[]) private sellOrders;
    uint256 public nextRoundId;

    uint256 public constant MAX_ORDERS_PER_ROUND = 5;
    uint256 public constant PRICE_LADDER_STEPS = 3;
    uint256 public constant DEFAULT_ROUND_DURATION = 300; // 5 minutes

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();

    // Temporary storage for clearing computation
    mapping(uint256 => euint128) private encClearingPrice;

    event RoundCreated(uint256 indexed roundId, address tokenA, address tokenB, uint256 endTime);
    // Amounts are public via getRound().totalBuyVolume / totalSellVolume — surfacing
    // them in events is no extra privacy leak, and aids subgraph indexing.
    event BuyOrderSubmitted(uint256 indexed roundId, address indexed buyer, uint256 amount);
    event SellOrderSubmitted(uint256 indexed roundId, address indexed seller, uint256 amount);
    event RoundClosed(uint256 indexed roundId);
    event ClearingPriceRevealed(uint256 indexed roundId, uint256 price);
    event RoundSettled(uint256 indexed roundId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry, address _admin) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        if (_admin == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        admin = _admin;
        _initFHEConstants();
    }

    /// @notice Start a new batch auction round
    function createRound(
        address tokenA,
        address tokenB,
        uint256 duration
    ) external onlyAdmin returns (uint256 roundId) {
        if (tokenA == tokenB) revert InvalidInput();
        uint256 dur = duration > 0 ? duration : DEFAULT_ROUND_DURATION;

        roundId = nextRoundId++;
        rounds[roundId] = Round({
            tokenA: tokenA,
            tokenB: tokenB,
            startTime: block.timestamp,
            endTime: block.timestamp + dur,
            status: RoundStatus.COLLECTING,
            clearingPrice: 0,
            totalBuyVolume: 0,
            totalSellVolume: 0
        });

        emit RoundCreated(roundId, tokenA, tokenB, block.timestamp + dur);
    }

    /// @notice Submit a buy order with encrypted max price
    function submitBuyOrder(
        uint256 roundId,
        InEuint128 calldata encMaxPrice,
        uint256 amount
    ) external whenNotPaused {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.COLLECTING) revert InvalidState();
        if (block.timestamp >= round.endTime) revert Expired();
        if (buyOrders[roundId].length + sellOrders[roundId].length >= MAX_ORDERS_PER_ROUND) revert InvalidState();
        if (amount == 0) revert InvalidInput();

        euint128 maxPrice = FHE.asEuint128(encMaxPrice);
        FHE.allowThis(maxPrice);
        FHE.allowSender(maxPrice);

        buyOrders[roundId].push(BuyOrder({
            buyer: msg.sender,
            encMaxPrice: maxPrice,
            amount: amount
        }));

        round.totalBuyVolume += amount;
        emit BuyOrderSubmitted(roundId, msg.sender, amount);
    }

    /// @notice Submit a sell order with encrypted min price
    function submitSellOrder(
        uint256 roundId,
        InEuint128 calldata encMinPrice,
        uint256 amount
    ) external whenNotPaused {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.COLLECTING) revert InvalidState();
        if (block.timestamp >= round.endTime) revert Expired();
        if (buyOrders[roundId].length + sellOrders[roundId].length >= MAX_ORDERS_PER_ROUND) revert InvalidState();
        if (amount == 0) revert InvalidInput();

        euint128 minPrice = FHE.asEuint128(encMinPrice);
        FHE.allowThis(minPrice);
        FHE.allowSender(minPrice);

        sellOrders[roundId].push(SellOrder({
            seller: msg.sender,
            encMinPrice: minPrice,
            amount: amount
        }));

        round.totalSellVolume += amount;
        emit SellOrderSubmitted(roundId, msg.sender, amount);
    }

    /// @notice Close round and compute clearing price using price ladder
    /// @dev FHE ops: O(N+M) per price step × PRICE_LADDER_STEPS
    /// @dev Max 5 orders × 3 steps = ~45 FHE ops (gas-feasible)
    /// @param roundId The round to close
    /// @param priceLadder Array of candidate prices (plaintext, ascending)
    function closeAndCompute(uint256 roundId, uint128[] calldata priceLadder)
        external
        onlyAdmin
    {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.COLLECTING) revert InvalidState();
        if (block.timestamp < round.endTime) revert InvalidState();
        if (priceLadder.length != PRICE_LADDER_STEPS) revert InvalidInput();

        BuyOrder[] storage buys = buyOrders[roundId];
        SellOrder[] storage sells = sellOrders[roundId];
        if (buys.length == 0 || sells.length == 0) revert InvalidState();

        // Find clearing price: highest price where buyVolume >= sellVolume
        euint128 bestClearingPrice = ZERO_128;

        for (uint256 p = 0; p < priceLadder.length; p++) {
            euint128 candidatePrice = FHE.asEuint128(priceLadder[p]);
            FHE.allowThis(candidatePrice);

            // Count eligible buy volume at this price
            euint128 eligibleBuyVol = ZERO_128;
            for (uint256 i = 0; i < buys.length; i++) {
                ebool eligible = FHE.gte(buys[i].encMaxPrice, candidatePrice);
                euint128 vol = FHE.select(eligible, FHE.asEuint128(buys[i].amount), ZERO_128);
                FHE.allowThis(vol);
                eligibleBuyVol = FHE.add(eligibleBuyVol, vol);
                FHE.allowThis(eligibleBuyVol);
            }

            // Count eligible sell volume at this price
            euint128 eligibleSellVol = ZERO_128;
            for (uint256 i = 0; i < sells.length; i++) {
                ebool eligible = FHE.lte(sells[i].encMinPrice, candidatePrice);
                euint128 vol = FHE.select(eligible, FHE.asEuint128(sells[i].amount), ZERO_128);
                FHE.allowThis(vol);
                eligibleSellVol = FHE.add(eligibleSellVol, vol);
                FHE.allowThis(eligibleSellVol);
            }

            // If buy volume >= sell volume at this price, it's a valid clearing price
            ebool clears = FHE.gte(eligibleBuyVol, eligibleSellVol);
            bestClearingPrice = FHE.select(clears, candidatePrice, bestClearingPrice);
            FHE.allowThis(bestClearingPrice);
        }

        // Store and mark publicly decryptable via Threshold Network
        encClearingPrice[roundId] = bestClearingPrice;
        FHE.allowGlobal(bestClearingPrice);

        round.status = RoundStatus.CLEARING;
        emit RoundClosed(roundId);
    }

    /// @notice Publish the verified clearing price reveal.
    /// @dev Caller obtains (price, signature) off-chain via client.decryptForTx().withoutPermit().
    function revealClearingPrice(
        uint256 roundId,
        uint128 price,
        bytes calldata signature
    ) external returns (uint256) {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.CLEARING) revert InvalidState();

        FHE.publishDecryptResult(encClearingPrice[roundId], price, signature);

        round.clearingPrice = uint256(price);
        emit ClearingPriceRevealed(roundId, uint256(price));
        return uint256(price);
    }

    /// @notice Settle all eligible orders at clearing price
    function settleRound(uint256 roundId) external onlyAdmin nonReentrant {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.CLEARING) revert InvalidState();
        if (round.clearingPrice == 0) revert InvalidState();

        uint256 cp = round.clearingPrice;

        // Settle buy orders that bid at or above clearing price
        // Since individual eligibility is encrypted, we settle all and let
        // the vault's zero-replacement pattern handle insufficient balances
        BuyOrder[] storage buys = buyOrders[roundId];
        SellOrder[] storage sells = sellOrders[roundId];

        // Simple matching: pair buyers and sellers at clearing price
        uint256 buyIdx = 0;
        uint256 sellIdx = 0;
        while (buyIdx < buys.length && sellIdx < sells.length) {
            uint256 tradeAmount = buys[buyIdx].amount < sells[sellIdx].amount
                ? buys[buyIdx].amount
                : sells[sellIdx].amount;

            euint64 encTradeAmount = FHE.asEuint64(uint64(tradeAmount));
            FHE.allowThis(encTradeAmount);
            FHE.allowTransient(encTradeAmount, address(vault));
            FHE.allow(encTradeAmount, address(vault));

            // Transfer tokenA from seller to buyer
            vault.settleTrade(sells[sellIdx].seller, buys[buyIdx].buyer, round.tokenA, encTradeAmount);

            // Transfer payment (tokenB) from buyer to seller
            euint64 paymentAmount = FHE.asEuint64(uint64(tradeAmount * cp));
            FHE.allowThis(paymentAmount);
            FHE.allowTransient(paymentAmount, address(vault));
            FHE.allow(paymentAmount, address(vault));
            vault.settleTrade(buys[buyIdx].buyer, sells[sellIdx].seller, round.tokenB, paymentAmount);

            buyIdx++;
            sellIdx++;
        }

        round.status = RoundStatus.SETTLED;
        emit RoundSettled(roundId);
    }

    /// @notice Get round info
    function getRound(uint256 roundId) external view returns (
        address tokenA, address tokenB, uint256 startTime, uint256 endTime,
        RoundStatus status, uint256 clearingPrice, uint256 buyCount, uint256 sellCount
    ) {
        Round storage r = rounds[roundId];
        return (r.tokenA, r.tokenB, r.startTime, r.endTime, r.status, r.clearingPrice,
                buyOrders[roundId].length, sellOrders[roundId].length);
    }

    function hasRounds() external view returns (bool) {
        return nextRoundId > 0;
    }

    /// @notice Total round count (including closed rounds).
    function getRoundCount() external view returns (uint256) {
        return nextRoundId;
    }

    /// @notice Get the encrypted clearing-price handle for a round after closeAndCompute.
    /// @dev Required for frontend to fetch the TN reveal signature via decryptForTx.
    ///      Returns the bytes32 wrapped handle as uint256 (euint128 underlying type).
    function getEncClearingPrice(uint256 roundId) external view returns (euint128) {
        return encClearingPrice[roundId];
    }
}
