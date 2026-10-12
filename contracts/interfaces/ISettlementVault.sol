// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

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

    /// @notice Lock up to `amount` of `user`'s balance into the caller's escrow pool
    /// @dev All-or-nothing under encryption: locks `amount` if covered, else 0
    /// @return locked Encrypted amount actually locked (caller may use the handle)
    function lockFunds(address user, address token, euint64 amount) external returns (euint64 locked);

    /// @notice Pay `amount` from the caller's escrow pool to `to`'s vault balance
    /// @dev Capped at the caller's pool
    function releaseFunds(address to, address token, euint64 amount) external;

    /// @notice Encrypted check that `user`'s balance is at least `threshold`
    function balanceAtLeast(address user, address token, uint64 threshold) external returns (ebool);

    /// @notice Get a user's encrypted vault balance for a token
    /// @dev Only the user themselves can unseal the returned handle
    function getEncBalance(address user, address token) external view returns (euint64);

    /// @notice Delegate read access of caller's encrypted balance to another contract
    /// @dev Required for cross-contract reads (e.g. PortfolioTracker)
    function delegateBalanceRead(address consumer, address token) external;
}
