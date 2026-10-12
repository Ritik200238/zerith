// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";

/// @title VaultEscrowHarness — TEST ONLY. Drives SettlementVault escrow the way a
///        feature contract would (handles + ACL), so unit tests can exercise it.
contract VaultEscrowHarness {
    ISettlementVault public immutable vault;
    euint64 public lastLocked;
    ebool public lastMeets;

    constructor(address _vault) {
        vault = ISettlementVault(_vault);
    }

    function lock(address user, address token, InEuint64 calldata enc) external {
        euint64 amount = FHE.asEuint64(enc);
        FHE.allowTransient(amount, address(vault));
        lastLocked = vault.lockFunds(user, token, amount);
    }

    function release(address to, address token, uint64 amount) external {
        euint64 a = FHE.asEuint64(amount);
        FHE.allowThis(a);
        FHE.allowTransient(a, address(vault));
        vault.releaseFunds(to, token, a);
    }

    function checkAtLeast(address user, address token, uint64 threshold) external {
        lastMeets = vault.balanceAtLeast(user, token, threshold);
    }
}
