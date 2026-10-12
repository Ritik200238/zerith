// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title LimitOrderEngine — Private limit orders with encrypted trigger prices
/// @notice Users set encrypted trigger prices. Oracle pushes plaintext market prices.
///         FHE.lte(oraclePrice, triggerPrice) checks trigger without revealing the trigger.
///         MEV bots can't front-run because trigger prices are hidden.
/// @dev Manual oracle for testnet. Production: integrate Chainlink/Pyth when on Fhenix mainnet.
contract LimitOrderEngine is ReentrancyGuard, FHEConstants {
    enum TriggerDirection { BUY_BELOW, SELL_ABOVE }
    enum OrderStatus { ACTIVE, TRIGGERED, SETTLED, CANCELLED }

    struct LimitOrder {
        address owner;
        address tokenBuy;
        address tokenSell;
        uint256 amount;              // Plaintext trade size
        euint128 encTriggerPrice;    // ENCRYPTED: the hidden trigger
        TriggerDirection direction;
        ebool executed;              // Encrypted: even execution status is hidden
        OrderStatus status;
        uint256 createdAt;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;

    mapping(uint256 => LimitOrder) public limitOrders;
    uint256[] public activeOrderIds;
    uint256 public nextOrderId;

    /// @notice Oracle address (admin for testnet, Chainlink for production)
    address public oracle;

    /// @notice Admin address for managing oracle
    address public admin;

    /// @notice Last price pushed by oracle
    uint128 public lastOraclePrice;

    uint256 public constant MAX_ORDERS_PER_CHECK = 50;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    event LimitOrderCreated(uint256 indexed orderId, address indexed owner, TriggerDirection direction);
    event PriceChecked(uint128 price, uint256 ordersChecked);
    event OrderTriggered(uint256 indexed orderId);
    event OrderSettled(uint256 indexed orderId);
    event OrderCancelled(uint256 indexed orderId);
    event OracleUpdated(address indexed newOracle);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert Unauthorized();
        _;
    }

    constructor(address _vault, address _registry, address _oracle) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        if (_oracle == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        oracle = _oracle;
        admin = msg.sender;
        _initFHEConstants();
    }

    /// @notice Create a limit order with encrypted trigger price
    /// @param tokenBuy Token to buy when triggered
    /// @param tokenSell Token to sell when triggered
    /// @param amount Trade size (plaintext)
    /// @param encTriggerPrice Encrypted price at which order should execute
    /// @param direction BUY_BELOW (buy when price drops) or SELL_ABOVE (sell when price rises)
    function createLimitOrder(
        address tokenBuy,
        address tokenSell,
        uint256 amount,
        InEuint128 calldata encTriggerPrice,
        TriggerDirection direction
    ) external whenNotPaused returns (uint256 orderId) {
        if (tokenBuy == tokenSell) revert InvalidInput();
        if (amount == 0) revert InvalidInput();

        orderId = nextOrderId++;
        euint128 trigger = FHE.asEuint128(encTriggerPrice);
        ebool notExecuted = FHE.asEbool(false);

        limitOrders[orderId] = LimitOrder({
            owner: msg.sender,
            tokenBuy: tokenBuy,
            tokenSell: tokenSell,
            amount: amount,
            encTriggerPrice: trigger,
            direction: direction,
            executed: notExecuted,
            status: OrderStatus.ACTIVE,
            createdAt: block.timestamp
        });

        // ACL: contract can use trigger for comparison, owner can unseal
        FHE.allowThis(trigger);
        FHE.allowSender(trigger);
        FHE.allowThis(notExecuted);
        FHE.allowSender(notExecuted);

        activeOrderIds.push(orderId);
        emit LimitOrderCreated(orderId, msg.sender, direction);
    }

    /// @notice Oracle pushes current price — contract checks all active orders
    /// @dev FHE ops per order: lte/gte(1), or(1) = 2 ops × N orders (max 50)
    /// @param currentPrice Current market price from oracle (plaintext)
    function checkPrice(uint128 currentPrice) external onlyOracle {
        lastOraclePrice = currentPrice;

        // Trivially encrypt oracle price for FHE comparison
        euint128 encCurrent = FHE.asEuint128(currentPrice);
        FHE.allowThis(encCurrent);

        uint256 len = activeOrderIds.length;
        uint256 toCheck = len > MAX_ORDERS_PER_CHECK ? MAX_ORDERS_PER_CHECK : len;

        for (uint256 i = 0; i < toCheck; i++) {
            uint256 orderId = activeOrderIds[i];
            LimitOrder storage order = limitOrders[orderId];

            if (order.status != OrderStatus.ACTIVE) continue;

            ebool triggered;
            if (order.direction == TriggerDirection.BUY_BELOW) {
                // Trigger when market price drops below trigger price
                triggered = FHE.lte(encCurrent, order.encTriggerPrice);
            } else {
                // Trigger when market price rises above trigger price
                triggered = FHE.gte(encCurrent, order.encTriggerPrice);
            }

            // Once triggered, stays true (or-latch)
            order.executed = FHE.or(order.executed, triggered);
            FHE.allowThis(order.executed);
            FHE.allow(order.executed, order.owner);
        }

        emit PriceChecked(currentPrice, toCheck);
    }

    /// @notice Settle triggered orders after decryption
    /// @dev Owner or keeper calls this. Marks the encrypted execution flag publicly decryptable.
    function settleTriggered(uint256 orderId) external nonReentrant {
        LimitOrder storage order = limitOrders[orderId];
        if (order.status != OrderStatus.ACTIVE) revert InvalidState();

        FHE.allowGlobal(order.executed);

        order.status = OrderStatus.TRIGGERED;
        emit OrderTriggered(orderId);
    }

    /// @notice Complete settlement with verified decryption of the execution flag.
    /// @dev Caller obtains (wasExecuted, signature) via client.decryptForTx().withoutPermit().
    function completeSettlement(
        uint256 orderId,
        bool wasExecuted,
        bytes calldata signature
    ) external nonReentrant {
        LimitOrder storage order = limitOrders[orderId];
        if (order.status != OrderStatus.TRIGGERED) revert InvalidState();

        FHE.publishDecryptResult(order.executed, wasExecuted, signature);

        if (wasExecuted) {
            // Audit fix C-LO1: previously this called
            //   vault.settleTrade(order.owner, address(this), ...)
            // which permanently locked tokens in this contract (no counterparty
            // to receive them, and address(this) cannot withdraw them).
            //
            // A limit order without a paired counterparty is conceptually an
            // "intent tracker" — it signals readiness to swap when the price
            // crosses the trigger. The actual swap execution must be handled
            // by a counterparty contract (AMM, order matcher) or a paired
            // limit order. For now, this contract just records the trigger
            // event; the user keeps their funds in the vault and can act on
            // them via other features.
            order.status = OrderStatus.SETTLED;
            emit OrderSettled(orderId);
        } else {
            // Not yet triggered — revert to active
            order.status = OrderStatus.ACTIVE;
        }

        _removeFromActive(orderId);
    }

    /// @notice Owner cancels their limit order
    function cancelLimitOrder(uint256 orderId) external {
        LimitOrder storage order = limitOrders[orderId];
        if (order.owner != msg.sender) revert Unauthorized();
        if (order.status != OrderStatus.ACTIVE) revert InvalidState();

        order.status = OrderStatus.CANCELLED;
        _removeFromActive(orderId);
        emit OrderCancelled(orderId);
    }

    /// @notice Owner views their trigger price handle (for unsealing)
    function getMyTriggerPrice(uint256 orderId) external view returns (euint128) {
        if (limitOrders[orderId].owner != msg.sender) revert Unauthorized();
        return limitOrders[orderId].encTriggerPrice;
    }

    /// @notice Update oracle address (current oracle or admin can rotate it)
    function setOracle(address _oracle) external {
        if (msg.sender != oracle && msg.sender != admin) revert Unauthorized();
        if (_oracle == address(0)) revert InvalidInput();
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    /// @notice Check if there are any active orders
    function hasActiveOrders() external view returns (bool) {
        return activeOrderIds.length > 0;
    }

    /// @notice Number of active (non-settled, non-cancelled) limit orders
    function getActiveOrderCount() external view returns (uint256) {
        return activeOrderIds.length;
    }

    function _removeFromActive(uint256 orderId) internal {
        uint256 len = activeOrderIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (activeOrderIds[i] == orderId) {
                activeOrderIds[i] = activeOrderIds[len - 1];
                activeOrderIds.pop();
                return;
            }
        }
    }
}
