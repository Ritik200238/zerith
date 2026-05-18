/**
 * One-shot snapshot of every UI-relevant on-chain counter so we can
 * diff BEFORE vs AFTER a UI sweep and prove each feature actually
 * moves state — not just emit a green "Transaction confirmed" toast.
 *
 * Run:
 *   npx hardhat run tasks/snapshot-all-counters.ts --network ethSepolia > snapshot.json
 *
 * Then:
 *   1. Save the output as snapshot-pre.json
 *   2. Run the UI E2E sweep
 *   3. Save the output as snapshot-post.json
 *   4. diff them; every feature should have moved at least one counter.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | string> {
  try { return await fn(); }
  catch (e: any) { return `ERR: ${String(e.message || e).slice(0, 80)}`; }
}

async function main() {
  const provider = ethers.provider;
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burner = burnerJson.address;
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  const sealed = await ethers.getContractAt("SealedAuction", addr.SealedAuction);
  const vickrey = await ethers.getContractAt("VickreyAuction", addr.VickreyAuction);
  const dutch = await ethers.getContractAt("DutchAuction", addr.DutchAuction);
  const batch = await ethers.getContractAt("BatchAuction", addr.BatchAuction);
  const overflow = await ethers.getContractAt("OverflowSale", addr.OverflowSale);
  const otc = await ethers.getContractAt("OTCBoard", addr.OTCBoard);
  const payments = await ethers.getContractAt("PrivatePayments", addr.PrivatePayments);
  const freelance = await ethers.getContractAt("FreelanceBidding", addr.FreelanceBidding);
  const multisig = await ethers.getContractAt("ConfidentialMultisig", addr.ConfidentialMultisig);
  const org = await ethers.getContractAt("Organization", addr.Organization);
  const allowlist = await ethers.getContractAt("AllowlistGate", addr.AllowlistGate);
  const streaming = await ethers.getContractAt("EncryptedStreaming", addr.EncryptedStreaming);
  const limits = await ethers.getContractAt("LimitOrderEngine", addr.LimitOrderEngine);
  const escrow = await ethers.getContractAt("Escrow", addr.Escrow);
  const royalty = await ethers.getContractAt("EncryptedRoyalty", addr.EncryptedRoyalty);
  const orderbook = await ethers.getContractAt("OrderBook", addr.OrderBook);
  const vault = await ethers.getContractAt("SettlementVault", addr.SettlementVault);

  const snap: Record<string, unknown> = {
    timestamp: Date.now(),
    burner,
    sealedAuctionCount: await safe("sealed", () => sealed.getAuctionCount().then((v: bigint) => v.toString())),
    vickreyAuctionCount: await safe("vickrey", () => vickrey.getAuctionCount().then((v: bigint) => v.toString())),
    dutchAuctionCount: await safe("dutch", () => dutch.getAuctionCount().then((v: bigint) => v.toString())),
    batchRoundCount: await safe("batch", () => batch.getRoundCount().then((v: bigint) => v.toString())),
    overflowSaleCount: await safe("overflow", () => overflow.getSaleCount().then((v: bigint) => v.toString())),
    otcRequestCount: await safe("otc", () => otc.getRequestCount().then((v: bigint) => v.toString())),
    paymentsNextSplitId: await safe("payments", () => payments.nextSplitId().then((v: bigint) => v.toString())),
    freelanceJobCount: await safe("freelance", () => freelance.getJobCount().then((v: bigint) => v.toString())),
    multisigCount: await safe("multisig", () => multisig.multisigCount().then((v: bigint) => v.toString())),
    orgCount: await safe("org", () => org.orgCount().then((v: bigint) => v.toString())),
    allowlistNextId: await safe("allowlist", () => allowlist.nextAllowlistId().then((v: bigint) => v.toString())),
    streamCount: await safe("streaming", () => streaming.getStreamCount().then((v: bigint) => v.toString())),
    limitsNextId: await safe("limits", () => limits.nextOrderId().then((v: bigint) => v.toString())),
    escrowDealCount: await safe("escrow", () => escrow.getDealCount().then((v: bigint) => v.toString())),
    royaltyCount: await safe("royalty", () => royalty.getRoyaltyCount().then((v: bigint) => v.toString())),
    orderbookNextId: await safe("orderbook", () => orderbook.nextOrderId().then((v: bigint) => v.toString())),
    burnerVaultCdexHandle: await safe("vaultBalance", () => vault.getEncBalance(burner, addr.ConfidentialToken).then((v: bigint) => "0x" + v.toString(16).padStart(64, "0"))),
  };

  console.log(JSON.stringify(snap, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
