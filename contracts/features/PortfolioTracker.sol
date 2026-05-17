// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title PortfolioTracker — Hidden multi-token portfolio value tracker
/// @notice Users track multiple token positions. Portfolio value computed as
///         sum(balance * price) using FHE — nobody sees individual holdings.
/// @dev Max 10 tokens per user for gas feasibility.
contract PortfolioTracker is FHEConstants {
    struct TrackedPosition {
        address token;
        bool active;
    }

    ISettlementVault public vault;

    /// @notice User's tracked positions
    mapping(address => TrackedPosition[]) private positions;
    mapping(address => uint256) public positionCount;

    /// @notice Cached portfolio value per user (computed on-demand)
    mapping(address => euint128) private portfolioValues;

    uint256 public constant MAX_POSITIONS = 10;

    error InvalidInput();
    error InvalidState();

    event TokenTracked(address indexed user, address indexed token);
    event TokenUntracked(address indexed user, address indexed token);
    event PortfolioComputed(address indexed user, uint256 tokenCount);

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        _initFHEConstants();
    }

    /// @notice Add a token to track in portfolio
    function trackToken(address token) external {
        if (positionCount[msg.sender] >= MAX_POSITIONS) revert InvalidState();
        if (token == address(0)) revert InvalidInput();

        // Check not already tracked
        TrackedPosition[] storage userPositions = positions[msg.sender];
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (userPositions[i].token == token && userPositions[i].active) {
                revert InvalidState();
            }
        }

        positions[msg.sender].push(TrackedPosition({
            token: token,
            active: true
        }));
        positionCount[msg.sender]++;

        emit TokenTracked(msg.sender, token);
    }

    /// @notice Remove a token from tracking
    function untrackToken(address token) external {
        TrackedPosition[] storage userPositions = positions[msg.sender];
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (userPositions[i].token == token && userPositions[i].active) {
                userPositions[i].active = false;
                positionCount[msg.sender]--;
                emit TokenUntracked(msg.sender, token);
                return;
            }
        }
        revert InvalidState();
    }

    /// @notice Compute total portfolio value across all tracked tokens
    /// @dev FHE ops: mul(N) + add(N) where N = position count = 2N total
    /// @dev Prices are plaintext (from oracle/UI). Balances are encrypted from vault.
    /// @param tokenPrices Array of prices corresponding to each tracked token (in order)
    function computePortfolioValue(uint64[] calldata tokenPrices) external returns (euint128) {
        TrackedPosition[] storage userPositions = positions[msg.sender];
        uint256 activeCount = positionCount[msg.sender];
        if (activeCount == 0) revert InvalidState();
        if (tokenPrices.length != userPositions.length) revert InvalidInput();

        euint128 totalValue = ZERO_128;

        uint256 priceIdx = 0;
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (!userPositions[i].active) {
                priceIdx++;
                continue;
            }

            // Read encrypted balance from vault
            euint64 balance = vault.getEncBalance(msg.sender, userPositions[i].token);

            // Multiply balance by plaintext price (result is euint128 for precision)
            // FHE.mul(euint64, uint64) => result fits in multiplication
            euint128 positionValue = FHE.mul(FHE.asEuint128(balance), FHE.asEuint128(tokenPrices[priceIdx]));
            FHE.allowThis(positionValue);

            // Accumulate total
            totalValue = FHE.add(totalValue, positionValue);
            FHE.allowThis(totalValue);

            priceIdx++;
        }

        // ACL: contract stores, user can unseal
        FHE.allowThis(totalValue);
        FHE.allowSender(totalValue);

        portfolioValues[msg.sender] = totalValue;
        FHE.allowSender(portfolioValues[msg.sender]);
        emit PortfolioComputed(msg.sender, activeCount);
        return totalValue;
    }

    /// @notice Read portfolio value handle (for unsealing via cofhejs)
    function getPortfolioValue() external view returns (euint128) {
        return portfolioValues[msg.sender];
    }

    /// @notice Get tracked tokens for a user
    function getTrackedTokens(address user) external view returns (address[] memory tokens) {
        TrackedPosition[] storage userPositions = positions[user];
        uint256 count = positionCount[user];
        tokens = new address[](count);

        uint256 idx = 0;
        for (uint256 i = 0; i < userPositions.length && idx < count; i++) {
            if (userPositions[i].active) {
                tokens[idx++] = userPositions[i].token;
            }
        }
    }
}
