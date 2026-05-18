/**
 * VickreyAuction + DutchAuction E2E.
 * - Vickrey: deployer creates, burner places encrypted bid
 * - Dutch:   deployer creates, burner buys at current price with encrypted amount
 *
 * Run: npx hardhat run tasks/verify-vickrey-dutch-e2e.ts --network ethSepolia
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
  console.log("Deployer:", deployer.address);
  console.log("Burner:  ", burner.address);

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
  console.log("  ✓ cofhe client connected as burner");

  // ───────── Vickrey ─────────
  console.log("\n=== Vickrey ===");
  const vickrey = await ethers.getContractAt("VickreyAuction", addr.VickreyAuction, deployer);
  const vTx = await vickrey.createAuction(addr.ConfidentialToken, addr.MockToken, 100, 300, 0);
  console.log("  create tx:", vTx.hash);
  await vTx.wait();
  const vId = (await vickrey.getAuctionCount()) - 1n;
  console.log("  auctionId:", vId.toString());

  const vResult = await client
    .encryptInputs([core.Encryptable.uint128(300n)])
    .execute();
  // @ts-expect-error contract typing
  const vBidTx = await vickrey.connect(burner).bid(vId, vResult[0]);
  console.log("  bid tx:", vBidTx.hash);
  const vBidRcpt = await vBidTx.wait();
  console.log("  ✓ vickrey bid status:", vBidRcpt?.status);

  // ───────── Dutch ─────────
  console.log("\n=== Dutch ===");
  const dutch = await ethers.getContractAt("DutchAuction", addr.DutchAuction, deployer);
  // DutchAuction createAuction signature: read it
  // Most Dutch impls: (token, paymentToken, amount, startPrice, endPrice, duration)
  // Try with reasonable defaults
  const dTx = await dutch.createAuction(
    addr.ConfidentialToken,
    addr.MockToken,
    100,        // amount
    1000,       // start price
    100,        // end price (decays)
    300,        // duration (5 min)
  );
  console.log("  create tx:", dTx.hash);
  await dTx.wait();
  const dId = (await dutch.getAuctionCount()) - 1n;
  console.log("  auctionId:", dId.toString());

  // Buyer buys with encrypted amount
  const dResult = await client
    .encryptInputs([core.Encryptable.uint64(10n)])
    .execute();
  // @ts-expect-error contract typing
  const dBuyTx = await dutch.connect(burner).buy(dId, dResult[0]);
  console.log("  buy tx:", dBuyTx.hash);
  const dBuyRcpt = await dBuyTx.wait();
  console.log("  ✓ dutch buy status:", dBuyRcpt?.status);

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ Vickrey + Dutch E2E WORKS        ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
