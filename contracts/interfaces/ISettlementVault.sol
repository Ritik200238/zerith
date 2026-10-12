// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64, sharedEuint64, sharedEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ISettlementVault — what feature contracts use from the vault
/// @notice Feature contracts lock users' funds into escrow when they commit and pay
///         out of that escrow at settlement. Encrypted values cross the boundary as
///         shared handles (CoFHE 1.0): share with FHE.shareEuint64(v, vault), and
///         receive results with FHE.receive*FromCall(result, vault).
interface ISettlementVault {
    /// @notice Lock up to `amount` of `user`'s balance into the caller's escrow pool.
    /// @dev All-or-nothing under encryption: locks `amount` if covered, else 0.
    /// @return locked The amount actually locked, shared with the caller
    function lockFunds(address user, address token, sharedEuint64 amount) external returns (sharedEuint64 locked);

    /// @notice Pay `amount` from the caller's escrow pool to `to`'s vault balance (capped at the pool)
    function releaseFunds(address to, address token, sharedEuint64 amount) external;

    /// @notice Encrypted check that `user`'s balance is at least `threshold`, shared with the caller
    function balanceAtLeast(address user, address token, uint64 threshold) external returns (sharedEbool);

    /// @notice A user's encrypted vault balance (only the user can unseal it)
    function getEncBalance(address user, address token) external view returns (euint64);
}
