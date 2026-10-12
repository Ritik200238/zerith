// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, externalEuint64, sharedEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";

/// @title VaultEscrowHarness — TEST ONLY. Drives SettlementVault escrow the way a
///        feature contract would (shared handles), so unit tests can exercise it.
contract VaultEscrowHarness {
    ISettlementVault public immutable vault;
    euint64 public lastLocked;
    ebool public lastMeets;

    constructor(address _vault) {
        vault = ISettlementVault(_vault);
    }

    function lock(address user, address token, externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.asEuint64(enc, proof);
        lastLocked = FHE.receiveEuint64FromCall(
            vault.lockFunds(user, token, FHE.shareEuint64(amount, address(vault))),
            address(vault)
        );
        FHE.allowThis(lastLocked);
    }

    function release(address to, address token, uint64 amount) external {
        euint64 a = FHE.asEuint64(amount);
        vault.releaseFunds(to, token, FHE.shareEuint64(a, address(vault)));
    }

    /// @dev Hands the vault a raw handle WITHOUT sharing it — the vault must reject it.
    function releaseUnshared(address to, address token, bytes32 handle) external {
        vault.releaseFunds(to, token, sharedEuint64.wrap(handle));
    }

    function checkAtLeast(address user, address token, uint64 threshold) external {
        lastMeets = FHE.receiveEboolFromCall(vault.balanceAtLeast(user, token, threshold), address(vault));
        FHE.allowThis(lastMeets);
    }
}
