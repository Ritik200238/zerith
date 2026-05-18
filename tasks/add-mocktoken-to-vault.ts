/**
 * Whitelist MockToken on the SettlementVault so the OTC settle test
 * can use a distinct tokenWant/tokenOffer pair (the contract enforces
 * tokenWant != tokenOffer at postRequest time).
 *
 * Run: npx hardhat run tasks/add-mocktoken-to-vault.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const vault = await ethers.getContractAt("SettlementVault", addr.SettlementVault, deployer);

  const isSupported = await vault.supportedTokens(addr.MockToken);
  console.log("MockToken supportedTokens:", isSupported);
  if (isSupported) {
    console.log("Already supported, exiting.");
    return;
  }

  console.log(`Adding ${addr.MockToken} to supportedTokens via vault.addSupportedToken(...)`);
  const tx = await vault.addSupportedToken(addr.MockToken);
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  ✓ status:", rcpt?.status);

  console.log("\nFinal MockToken supportedTokens:", await vault.supportedTokens(addr.MockToken));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
