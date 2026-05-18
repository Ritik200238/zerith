/**
 * EncryptedStreaming E2E — burner creates a stream with encrypted rate.
 * Run: npx hardhat run tasks/verify-streaming-e2e.ts --network ethSepolia
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
  console.log("Payer (burner):", burner.address);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

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
  const cfg = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(cfg);
  const adapterRes = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  console.log("  ✓ cofhe client connected");

  // Encrypt rate = 1 per second
  const result = await client.encryptInputs([core.Encryptable.uint64(1n)]).execute();
  console.log("  ✓ encrypted rate=1/s");

  // Create 1-hour stream to a deterministic recipient
  const streaming = await ethers.getContractAt(
    "EncryptedStreaming",
    addr.EncryptedStreaming,
    burner,
  );
  const recipient = "0x0000000000000000000000000000000000001001"; // simple non-zero recipient
  const startTime = Math.floor(Date.now() / 1000) + 60; // start in 1 min
  const endTime = startTime + 3600; // 1h
  const tx = await streaming.createStream(
    recipient,
    addr.ConfidentialToken,
    result[0],
    startTime,
    endTime,
  );
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  ✓ stream created, status:", rcpt?.status);

  const count = await streaming.getStreamCount();
  console.log("  total streams:", count.toString());

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ EncryptedStreaming E2E WORKS     ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
