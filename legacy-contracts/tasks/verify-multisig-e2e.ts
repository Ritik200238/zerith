/**
 * ConfidentialMultisig E2E — burner creates a multisig with encrypted threshold.
 * Run: npx hardhat run tasks/verify-multisig-e2e.ts --network ethSepolia
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
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  const sdk = await import(path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "node.js"));
  const core = await import(path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "core.js"));
  const chains = await import(path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "chains.js"));
  const adapters = await import(path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "adapters.js"));
  const cfg = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(cfg);
  const adapterRes = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  console.log("Creator (burner):", burner.address);

  const result = await client.encryptInputs([core.Encryptable.uint64(2n)]).execute(); // 2-of-N threshold
  console.log("  ✓ encrypted threshold=2");

  const multisig = await ethers.getContractAt("ConfidentialMultisig", addr.ConfidentialMultisig, burner);
  const tx = await multisig.createMultisig(addr.ConfidentialToken, result[0]);
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  ✓ multisig created, status:", rcpt?.status);

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ ConfidentialMultisig E2E WORKS   ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  process.exit(1);
});
