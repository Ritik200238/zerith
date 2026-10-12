// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title OverflowSale — Fixed-price token sale with encrypted deposits and pro-rata allocation
/// @notice Project sets a fixed price. Users deposit encrypted amounts. If oversubscribed,
///         everyone gets proportional allocation. Excess refunded. Simplest, fairest launch.
/// @dev Encrypted deposits hide individual participation amounts. Total demand computed
///      on ciphertext via FHE.add. Pro-rata ratio applied via FHE.mul + FHE.div.
contract OverflowSale is ReentrancyGuard, FHEConstants {
    enum SaleStatus { OPEN, COMPUTING, SETTLED, CANCELLED }

    struct Sale {
        address seller;
        address token;
        address paymentToken;
        uint256 tokensForSale;    // Plaintext — public
        uint256 pricePerToken;    // Plaintext — public (fixed price)
        uint256 deadline;
        uint256 depositCount;
        euint64 totalDeposited;   // ENCRYPTED — total demand hidden until settlement
        uint64 revealedTotal;     // Set after async decrypt
        SaleStatus status;
    }

    struct Deposit {
        address depositor;
        euint64 encAmount;        // Encrypted deposit amount
        bool claimed;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;

    mapping(uint256 => Sale) public sales;
    mapping(uint256 => Deposit[]) public deposits;
    mapping(uint256 => mapping(address => bool)) public hasDeposited;
    uint256 public nextSaleId;

    uint256 public constant MAX_DEPOSITS = 50;
    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%
    uint256 public constant MIN_DURATION = 300;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    event SaleCreated(uint256 indexed saleId, address indexed seller, uint256 tokensForSale, uint256 pricePerToken, uint256 deadline);
    event DepositPlaced(uint256 indexed saleId, address indexed depositor);
    event SaleComputing(uint256 indexed saleId);
    event SaleSettled(uint256 indexed saleId, uint64 totalDemand, bool oversubscribed);
    event AllocationClaimed(uint256 indexed saleId, address indexed depositor, uint64 tokensReceived, uint64 refund);
    event SaleCancelled(uint256 indexed saleId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        _initFHEConstants();
    }

    /// @notice Seller creates a fixed-price sale
    function createSale(
        address token,
        address paymentToken,
        uint256 tokensForSale,
        uint256 pricePerToken,
        uint256 duration
    ) external whenNotPaused returns (uint256 saleId) {
        if (token == paymentToken) revert InvalidInput();
        if (tokensForSale == 0 || pricePerToken == 0) revert InvalidInput();
        if (duration < MIN_DURATION) revert InvalidInput();

        saleId = nextSaleId++;

        euint64 initTotal = FHE.asEuint64(0);
        FHE.allowThis(initTotal);

        sales[saleId] = Sale({
            seller: msg.sender,
            token: token,
            paymentToken: paymentToken,
            tokensForSale: tokensForSale,
            pricePerToken: pricePerToken,
            deadline: block.timestamp + duration,
            depositCount: 0,
            totalDeposited: initTotal,
            revealedTotal: 0,
            status: SaleStatus.OPEN
        });

        emit SaleCreated(saleId, msg.sender, tokensForSale, pricePerToken, block.timestamp + duration);
    }

    /// @notice User deposits encrypted amount to participate
    /// @dev Amount is how many TOKENS they want (not payment amount).
    ///      Actual payment = amount × pricePerToken, computed at claim.
    function deposit(uint256 saleId, InEuint64 calldata encTokenAmount) external whenNotPaused {
        Sale storage sale = sales[saleId];
        if (sale.status != SaleStatus.OPEN) revert InvalidState();
        if (block.timestamp >= sale.deadline) revert InvalidState();
        if (sale.seller == msg.sender) revert InvalidInput();
        if (hasDeposited[saleId][msg.sender]) revert InvalidState();
        if (sale.depositCount >= MAX_DEPOSITS) revert InvalidState();

        euint64 amount = FHE.asEuint64(encTokenAmount);

        // Accumulate total demand on ciphertext
        sale.totalDeposited = FHE.add(sale.totalDeposited, amount);
        FHE.allowThis(sale.totalDeposited);

        deposits[saleId].push(Deposit({
            depositor: msg.sender,
            encAmount: amount,
            claimed: false
        }));

        FHE.allowThis(amount);
        FHE.allowSender(amount);

        hasDeposited[saleId][msg.sender] = true;
        sale.depositCount++;

        emit DepositPlaced(saleId, msg.sender);
    }

    /// @notice Trigger settlement — decrypt total demand to determine if oversubscribed
    function settle(uint256 saleId) external {
        Sale storage sale = sales[saleId];
        if (sale.status != SaleStatus.OPEN) revert InvalidState();
        if (block.timestamp < sale.deadline) revert InvalidState();

        if (sale.depositCount == 0) {
            sale.status = SaleStatus.CANCELLED;
            emit SaleCancelled(saleId);
            return;
        }

        FHE.allowGlobal(sale.totalDeposited);
        sale.status = SaleStatus.COMPUTING;

        emit SaleComputing(saleId);
    }

    /// @notice Finalize after total demand is decrypted
    /// @dev Caller obtains (totalDemand, signature) via client.decryptForTx().withoutPermit().
    function finalizeSettlement(uint256 saleId, uint64 totalDemand, bytes calldata signature) external {
        Sale storage sale = sales[saleId];
        if (sale.status != SaleStatus.COMPUTING) revert InvalidState();

        FHE.publishDecryptResult(sale.totalDeposited, totalDemand, signature);

        sale.revealedTotal = totalDemand;
        sale.status = SaleStatus.SETTLED;

        bool oversubscribed = totalDemand > sale.tokensForSale;
        emit SaleSettled(saleId, totalDemand, oversubscribed);
    }

    /// @notice Depositor claims their allocation after settlement
    /// @dev If oversubscribed: allocation = (myDeposit / totalDemand) × supply (pro-rata)
    ///      If undersubscribed: allocation = myDeposit (full)
    ///      Excess payment refunded.
    function claimAllocation(uint256 saleId, uint256 depositIndex) external nonReentrant {
        Sale storage sale = sales[saleId];
        if (sale.status != SaleStatus.SETTLED) revert InvalidState();

        Deposit storage dep = deposits[saleId][depositIndex];
        if (dep.depositor != msg.sender) revert Unauthorized();
        if (dep.claimed) revert InvalidState();

        // Mark individual deposit amount publicly decryptable (this depositor's own).
        FHE.allowGlobal(dep.encAmount);
    }

    /// @notice Finalize individual claim with verified decryption signature
    function finalizeClaimAllocation(
        uint256 saleId,
        uint256 depositIndex,
        uint64 myDeposit,
        bytes calldata signature
    ) external nonReentrant {
        Sale storage sale = sales[saleId];
        if (sale.status != SaleStatus.SETTLED) revert InvalidState();

        Deposit storage dep = deposits[saleId][depositIndex];
        if (dep.depositor != msg.sender) revert Unauthorized();
        if (dep.claimed) revert InvalidState();

        FHE.publishDecryptResult(dep.encAmount, myDeposit, signature);

        dep.claimed = true;

        uint64 allocation;
        if (sale.revealedTotal <= sale.tokensForSale) {
            // Undersubscribed — everyone gets what they asked
            allocation = myDeposit;
        } else {
            // Oversubscribed — pro-rata
            allocation = uint64((uint256(myDeposit) * sale.tokensForSale) / uint256(sale.revealedTotal));
        }

        if (allocation == 0) return;

        // Payment for allocated tokens
        uint256 totalPayment = uint256(allocation) * sale.pricePerToken;
        uint256 fee = (totalPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerReceives = totalPayment - fee;

        // Settle via vault
        euint64 tokenAmount = FHE.asEuint64(allocation);
        euint64 paymentToSeller = FHE.asEuint64(uint64(sellerReceives));
        euint64 feeAmount = FHE.asEuint64(uint64(fee));

        FHE.allowThis(tokenAmount);
        FHE.allowThis(paymentToSeller);
        FHE.allowThis(feeAmount);
        FHE.allowTransient(tokenAmount, address(vault));
        FHE.allow(tokenAmount, address(vault));
        FHE.allowTransient(paymentToSeller, address(vault));
        FHE.allow(paymentToSeller, address(vault));

        vault.settleTrade(sale.seller, msg.sender, sale.token, tokenAmount);
        vault.settleTrade(msg.sender, sale.seller, sale.paymentToken, paymentToSeller);

        if (fee > 0) {
            FHE.allowTransient(feeAmount, address(vault));
            FHE.allow(feeAmount, address(vault));
            vault.settleTrade(msg.sender, registry.feeCollector(), sale.paymentToken, feeAmount);
        }

        emit AllocationClaimed(saleId, msg.sender, allocation, myDeposit - allocation);
    }

    /// @notice Cancel if no deposits
    function cancelSale(uint256 saleId) external {
        Sale storage sale = sales[saleId];
        if (sale.seller != msg.sender) revert Unauthorized();
        if (sale.status != SaleStatus.OPEN) revert InvalidState();
        if (sale.depositCount > 0) revert InvalidState();

        sale.status = SaleStatus.CANCELLED;
        emit SaleCancelled(saleId);
    }

    function getSale(uint256 saleId) external view returns (
        address seller, address token, address paymentToken,
        uint256 tokensForSale, uint256 pricePerToken, uint256 deadline,
        uint256 depositCount, SaleStatus status, uint64 revealedTotal
    ) {
        Sale storage s = sales[saleId];
        return (s.seller, s.token, s.paymentToken, s.tokensForSale,
                s.pricePerToken, s.deadline, s.depositCount, s.status, s.revealedTotal);
    }

    function getSaleCount() external view returns (uint256) {
        return nextSaleId;
    }

    function hasSales() external view returns (bool) {
        return nextSaleId > 0;
    }
}
