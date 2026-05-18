/**
 * ProofOfReserves E2E.
 * Burner has 5 CDEX in the vault (deposited 10, withdrew 5).
 * - delegateBalanceRead so PoR can read vault.getEncBalance
 * - requestProof(token, threshold=1) → encrypted balance >= 1 (which it is, = 5)
 *
 * Run: npx hardhat run tasks/verify-por-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const provider = ethers.provider;
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);
  console.log("Burner:", burner.address);

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  const vault = await ethers.getContractAt("SettlementVault", addresses.SettlementVault, burner);
  const por = await ethers.getContractAt("ProofOfReserves", addresses.ProofOfReserves, burner);

  // Step 1: delegateBalanceRead so PoR can read burner's vault balance
  console.log("\n--- Step 1: vault.delegateBalanceRead(PoR, token) ---");
  const delTx = await vault.delegateBalanceRead(addresses.ProofOfReserves, addresses.ConfidentialToken);
  console.log("  tx:", delTx.hash);
  const delRcpt = await delTx.wait();
  console.log("  ✓ delegated, status:", delRcpt?.status);

  // Step 2: requestProof
  console.log("\n--- Step 2: por.requestProof(token, threshold=1) ---");
  const tx = await por.requestProof(addresses.ConfidentialToken, 1);
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  ✓ proof requested, status:", rcpt?.status);

  const count = await por.getClaimCount();
  console.log("  total claims:", count.toString());

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ ProofOfReserves E2E WORKS        ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
