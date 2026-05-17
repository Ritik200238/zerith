/**
 * Seed Sepolia state with one of every visible artifact.
 *
 * Turns a cold empty testnet into an alive platform so judges and first-time
 * visitors see real activity instead of "0 / 0 / 0 / 0" everywhere.
 *
 * Strategy: only operations that don't need client-side FHE encryption can
 * run from a Hardhat script reliably on Sepolia. That's enough for visual
 * aliveness — every contract's count goes from 0 to ≥1. Bidding, encrypted
 * deposits, OTC requests, and payroll splits stay for manual seed via the
 * browser UI (where cofhejs is available).
 *
 * What this script does (all plaintext-arg operations):
 *   1. Deploy a second ConfidentialToken ("MOCK") so auctions have a
 *      distinct payment token (contracts require token != paymentToken).
 *   2. Whitelist MOCK on SettlementVault.
 *   3. Create 1 Sealed auction (24h)
 *   4. Create 1 Vickrey auction (24h)
 *   5. Create 1 Dutch auction (24h)
 *   6. Create 1 Batch round (24h)
 *   7. Create 1 Overflow sale (24h)
 *   8. Delegate vault balance read to PoR + request a PoR proof (threshold=1)
 *
 * Run: npx hardhat run tasks/seed-state.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const TWENTY_FOUR_HOURS = 60 * 60 * 24;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Seeding from:", signer.address);
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("ETH balance:", ethers.formatEther(bal));
  if (bal < ethers.parseEther("0.01")) {
    throw new Error("Need at least 0.01 ETH on Sepolia. Top up the deployer.");
  }

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  // ── 1. Deploy MOCK token (or reuse if already deployed) ─────────
  let mockAddr: string = addresses.MockToken;
  if (!mockAddr || mockAddr === "0x0000000000000000000000000000000000000000") {
    console.log("\n--- Deploying MOCK ConfidentialToken ---");
    const TokenF = await ethers.getContractFactory("ConfidentialToken");
    const mock = await TokenF.deploy();
    await mock.waitForDeployment();
    mockAddr = await mock.getAddress();
    console.log("MOCK deployed to:", mockAddr);

    // Whitelist on vault
    const vault = await ethers.getContractAt("SettlementVault", addresses.SettlementVault);
    const tx = await vault.addSupportedToken(mockAddr);
    await tx.wait();
    console.log("MOCK whitelisted on SettlementVault");
  } else {
    console.log("\nMOCK already deployed at:", mockAddr);
  }

  const cdex = addresses.ConfidentialToken;
  console.log("CDEX:", cdex);
  console.log("MOCK:", mockAddr);

  // ── 2. Sealed auction (24h) ─────────────────────────────────────
  console.log("\n--- Seeding SealedAuction ---");
  const sealed = await ethers.getContractAt("SealedAuction", addresses.SealedAuction);
  {
    const tx = await sealed.createAuction(
      cdex,          // token being auctioned
      mockAddr,      // payment token
      100,           // amount for sale
      TWENTY_FOUR_HOURS, // 24h duration
      60,            // snipe extension
    );
    const r = await tx.wait();
    console.log("Sealed auction created. tx:", r?.hash);
  }

  // ── 3. Vickrey auction (24h) ────────────────────────────────────
  console.log("\n--- Seeding VickreyAuction ---");
  const vickrey = await ethers.getContractAt("VickreyAuction", addresses.VickreyAuction);
  {
    const tx = await vickrey.createAuction(
      cdex, mockAddr, 100, TWENTY_FOUR_HOURS, 60,
    );
    const r = await tx.wait();
    console.log("Vickrey auction created. tx:", r?.hash);
  }

  // ── 4. Dutch auction (24h, price decays 1000 → 100) ─────────────
  console.log("\n--- Seeding DutchAuction ---");
  const dutch = await ethers.getContractAt("DutchAuction", addresses.DutchAuction);
  {
    const tx = await dutch.createAuction(
      cdex,           // token
      mockAddr,       // payment
      100,            // totalSupply
      1000,           // startPrice
      100,            // endPrice
      TWENTY_FOUR_HOURS,
    );
    const r = await tx.wait();
    console.log("Dutch auction created. tx:", r?.hash);
  }

  // ── 5. Batch round (24h) ────────────────────────────────────────
  console.log("\n--- Seeding BatchAuction (round) ---");
  const batch = await ethers.getContractAt("BatchAuction", addresses.BatchAuction);
  {
    const tx = await batch.createRound(
      cdex,           // tokenA (sellers offer this)
      mockAddr,       // tokenB (buyers offer this)
      TWENTY_FOUR_HOURS,
    );
    const r = await tx.wait();
    console.log("Batch round created. tx:", r?.hash);
  }

  // ── 6. Overflow sale (24h, fixed price 100) ─────────────────────
  console.log("\n--- Seeding OverflowSale ---");
  const overflow = await ethers.getContractAt("OverflowSale", addresses.OverflowSale);
  {
    const tx = await overflow.createSale(
      cdex,           // token
      mockAddr,       // payment
      1000,           // tokensForSale
      100,            // pricePerToken
      TWENTY_FOUR_HOURS,
    );
    const r = await tx.wait();
    console.log("Overflow sale created. tx:", r?.hash);
  }

  // ── 7. Proof of Reserves claim (threshold = 1) ──────────────────
  // Works even with zero vault balance — produces a "verified FALSE" claim
  // when revealed. Still demonstrates the mechanism end-to-end.
  console.log("\n--- Seeding ProofOfReserves claim ---");
  const vault = await ethers.getContractAt("SettlementVault", addresses.SettlementVault);
  try {
    const tx1 = await vault.delegateBalanceRead(addresses.ProofOfReserves, cdex);
    await tx1.wait();
    console.log("delegateBalanceRead. tx:", tx1.hash);
  } catch (e: unknown) {
    console.warn("delegateBalanceRead failed:", (e as Error).message.slice(0, 200));
  }
  const por = await ethers.getContractAt("ProofOfReserves", addresses.ProofOfReserves);
  {
    const tx = await por.requestProof(cdex, 1);
    const r = await tx.wait();
    console.log("PoR claim requested. tx:", r?.hash);
  }

  // ── 8. Persist MOCK address + seed marker ───────────────────────
  addresses.MockToken = mockAddr;
  addresses._lastSeededAt = new Date().toISOString();
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

  console.log("\n✓ Seed complete. Verify with `npm run launch-check` — counts should be ≥1.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
