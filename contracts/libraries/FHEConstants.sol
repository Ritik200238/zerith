// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title FHEConstants — Pre-encrypted constants shared across contracts
/// @notice Encrypt common values once in constructor to save gas on repeated use
/// @dev Each contract that inherits this gets its own copies (allowThis is per-contract)
abstract contract FHEConstants {
    euint64 internal ZERO_64;

    /// @dev Call in constructor of inheriting contracts
    function _initFHEConstants() internal {
        ZERO_64 = FHE.asEuint64(0);
        FHE.allowThis(ZERO_64);
    }
}
