// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ISettlementVault — Interface for the centralized settlement vault
/// @notice Feature contracts call settleTrade() to move tokens between users
interface ISettlementVault {
    /// @notice Execute an encrypted settlement between two users
    /// @dev Only callable by authorized settler contracts
    /// @dev Uses zero-replacement: if `from` has insufficient balance, transfers 0
    /// @param from Address to debit
    /// @param to Address to credit
    /// @param token FHERC20 token address
    /// @param amount Encrypted amount to transfer (euint64)
    function settleTrade(
        address from,
        address to,
        address token,
        euint64 amount
    ) external;

    /// @notice Get a user's encrypted vault balance for a token
    /// @dev Only the user themselves can unseal the returned handle
    function getEncBalance(address user, address token) external view returns (euint64);

    /// @notice Delegate read access of caller's encrypted balance to another contract
    /// @dev Required for cross-contract reads (e.g. PortfolioTracker)
    function delegateBalanceRead(address consumer, address token) external;
}
