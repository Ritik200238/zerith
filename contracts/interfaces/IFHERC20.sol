// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IFHERC20 — Interface for FHERC20 confidential token operations
/// @notice Used by SettlementVault to interact with any FHERC20-compliant token
interface IFHERC20 {
    /// @notice Transfer encrypted amount from caller to recipient
    function confidentialTransfer(address to, euint64 amount) external returns (euint64);

    /// @notice Transfer encrypted amount from `from` to `to` (requires operator approval)
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);

    /// @notice Check if `operator` is approved to act on behalf of `owner`
    function isOperator(address owner, address operator) external view returns (bool);

    /// @notice Set operator approval with expiration timestamp
    function setOperator(address operator, uint48 expiration) external returns (bool);

    /// @notice Get encrypted balance handle for account (only the account owner can unseal)
    function confidentialBalanceOf(address account) external view returns (euint64);

    /// @notice Get the token name
    function name() external view returns (string memory);

    /// @notice Get the token symbol
    function symbol() external view returns (string memory);

    /// @notice Get the token decimals
    function decimals() external view returns (uint8);
}
