/**
 * Three-in-one E2E: Organization + OrderBook (Trade) + AllowlistGate.
 *
 * Closes the remaining smoke-only ⚠s in CLAUDE.md Phase 2 for these
 * three secondary features. Each gets the minimum tx that proves the
 * encrypted machinery + happy path:
 *
 *   1. Organization.createOrg("Zerith DAO") — burner1 admin.
 *   2. OrderBook.createOrder(CDEX→MockToken, amount=1000, encPrice=50)
 *      — encrypted price, plaintext amount, SELL side.
 *   3. AllowlistGate.createAllowlist(merkleRoot, "Zerith launch")
 *      — burner1 creator.
 *
 * Run: npx hardhat run tasks/verify-org-trade-allowlist-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function loadCofhe(provider: unknown, signer: unknown) {
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
  const adapterRes = await adapters.Ethers6Adapter(provider, signer);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  return { client, Encryptable: core.Encryptable };
}

async function main() {
  const provider = ethers.provider;
  const b1Json = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burner = new ethers.Wallet(b1Json.privateKey, provider);
  console.log("Burner:", burner.address);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  // ── 1. Organization.createOrg ──
  console.log("\n--- 1. Organization.createOrg ---");
  const org = await ethers.getContractAt("Organization", addr.Organization, burner);
  const orgTx = await org.createOrg("Zerith DAO");
  console.log("  tx:", orgTx.hash);
  await orgTx.wait();
  const orgCount = await org.orgCount();
  console.log("  ✓ orgCount:", orgCount.toString());

  // ── 2. OrderBook.createOrder ──
  console.log("\n--- 2. OrderBook.createOrder (CDEX→MockToken, SELL, encPrice=50) ---");
  const orderbook = await ethers.getContractAt("OrderBook", addr.OrderBook, burner);
  const { client, Encryptable } = await loadCofhe(provider, burner);
  const enc = await client.encryptInputs([Encryptable.uint128(50n)]).execute();
  // OrderSide enum: 0=BUY, 1=SELL (per Solidity convention)
  const orderTx = await orderbook.createOrder(
    addr.ConfidentialToken,
    addr.MockToken,
    1000,
    enc[0],
    1,
  );
  console.log("  tx:", orderTx.hash);
  await orderTx.wait();
  const nextOrderId = await orderbook.nextOrderId();
  console.log("  ✓ nextOrderId:", nextOrderId.toString());

  // ── 3. AllowlistGate.createAllowlist ──
  console.log("\n--- 3. AllowlistGate.createAllowlist ---");
  const al = await ethers.getContractAt("AllowlistGate", addr.AllowlistGate, burner);
  // Use a real-looking Merkle root (just a keccak of a sample address list)
  const merkleRoot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]"],
      [[burner.address, "0x0000000000000000000000000000000000001001"]],
    ),
  );
  const alTx = await al.createAllowlist(merkleRoot, "Zerith launch allowlist");
  console.log("  tx:", alTx.hash);
  await alTx.wait();
  const alCount = await al.nextAllowlistId();
  console.log("  ✓ nextAllowlistId:", alCount.toString());
  console.log("  merkleRoot:", merkleRoot);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   ✓ Organization + OrderBook + AllowlistGate E2E WORKS     ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
