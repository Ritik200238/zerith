/**
 * BatchAuction + OverflowSale E2E.
 * - Batch: deployer creates round (onlyAdmin), burner submits encrypted buy order
 * - Overflow: deployer creates sale, burner deposits encrypted amount
 *
 * Run: npx hardhat run tasks/verify-batch-overflow-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const provider = ethers.provider;
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  // cofhe client as burner
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
  console.log("  ✓ cofhe client connected as burner");

  // ───────── Batch ─────────
  console.log("\n=== BatchAuction ===");
  const batch = await ethers.getContractAt("BatchAuction", addr.BatchAuction, deployer);
  const bTx = await batch.createRound(addr.ConfidentialToken, addr.MockToken, 600); // 10min
  console.log("  create tx:", bTx.hash);
  await bTx.wait();
  const bId = (await batch.getRoundCount()) - 1n;
  console.log("  roundId:", bId.toString());

  const bResult = await client.encryptInputs([core.Encryptable.uint128(50n)]).execute(); // maxPrice
  // @ts-expect-error contract typing
  const bSubmitTx = await batch.connect(burner).submitBuyOrder(bId, bResult[0], 10); // 10 units
  console.log("  submitBuyOrder tx:", bSubmitTx.hash);
  const bRcpt = await bSubmitTx.wait();
  console.log("  ✓ batch buy order status:", bRcpt?.status);

  // ───────── Overflow ─────────
  console.log("\n=== OverflowSale ===");
  const ov = await ethers.getContractAt("OverflowSale", addr.OverflowSale, deployer);
  const ovCreateTx = await ov.createSale(
    addr.ConfidentialToken,
    addr.MockToken,
    1000, // tokensForSale
    2,    // pricePerToken
    300,  // duration (5 min min)
  );
  console.log("  create tx:", ovCreateTx.hash);
  await ovCreateTx.wait();
  const ovId = (await ov.getSaleCount()) - 1n;
  console.log("  saleId:", ovId.toString());

  const ovResult = await client.encryptInputs([core.Encryptable.uint64(5n)]).execute(); // want 5 tokens
  // @ts-expect-error contract typing
  const ovDepTx = await ov.connect(burner).deposit(ovId, ovResult[0]);
  console.log("  deposit tx:", ovDepTx.hash);
  const ovRcpt = await ovDepTx.wait();
  console.log("  ✓ overflow deposit status:", ovRcpt?.status);

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ Batch + Overflow E2E WORKS       ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
