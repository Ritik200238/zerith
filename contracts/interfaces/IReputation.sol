// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title IReputation — Interface for the non-blocking reputation system
/// @notice Feature contracts call recordTrade() after successful settlements
interface IReputation {
    /// @notice Record that a trade occurred between two parties for a specific tradeId
    /// @dev Only callable by authorized feature contracts
    /// @dev Non-blocking: if this call fails, trading still works
    /// @dev tradeId is the auction/order/job ID — used to scope rating eligibility
    function recordTrade(address partyA, address partyB, uint256 tradeId) external;

    /// @notice Get the plaintext trade count for any user
    function getTradeCount(address user) external view returns (uint256);
}
