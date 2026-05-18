/**
 * Read the burner's encrypted vault balance handle for CDEX before + after.
 *
 * With the OLD UI (decimals=18), every UI deposit overflowed and the vault
 * zero-replaced — so the encrypted balance handle stayed the same. With
 * the fixed UI (decimals=6), the handle should change after a deposit.
 *
 * Run: npx hardhat run tasks/verify-deposit-actually-moves-tokens.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const provider = ethers.provider;
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burnerAddr = burnerJson.address;

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const vault = await ethers.getContractAt("SettlementVault", addr.SettlementVault);

  // encBalances mapping is (user, token) → euint64 (a uint256 handle)
  const handle: bigint = await vault.getEncBalance(burnerAddr, addr.ConfidentialToken);
  console.log("Burner:", burnerAddr);
  console.log("Vault.encBalances(burner, CDEX):");
  console.log("  raw handle:", handle.toString());
  console.log("  hex handle:", "0x" + handle.toString(16).padStart(64, "0"));
}

main().then(() => process.exit(0));
