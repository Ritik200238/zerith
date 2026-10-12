/**
 * OTCBoard E2E — burner posts a private OTC request with encrypted amount + price range.
 *
 * Run: npx hardhat run tasks/verify-otc-e2e.ts --network ethSepolia
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
  console.log("Requester (burner):", burner.address);

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const otc = await ethers.getContractAt("OTCBoard", addresses.OTCBoard, burner);

  // Encrypt amount + minPrice + maxPrice
  console.log("\n--- Encrypt OTC request fields via @cofhe/sdk ---");
  const sdk = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "node.js")
  );
  const core = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "core.js")
  );
  const chains = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "chains.js")
  );
  const adapters = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "adapters.js")
  );

  const config = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(config);
  const adapterRes = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);

  const result = await client
    .encryptInputs([
      core.Encryptable.uint128(1000n), // amount wanted
      core.Encryptable.uint128(95n),   // minPrice
      core.Encryptable.uint128(105n),  // maxPrice
    ])
    .execute();
  console.log("  ✓ encrypted 3 fields, count:", result.length);

  // Post request
  console.log("\n--- postRequest ---");
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const tx = await otc.postRequest(
    addresses.ConfidentialToken,
    addresses.MockToken,
    result[0],
    result[1],
    result[2],
    deadline,
  );
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  ✓ posted, status:", rcpt?.status);

  const count = await otc.getRequestCount();
  console.log("  total request count:", count.toString());

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ OTCBoard E2E WORKS               ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
