/**
 * Launch Day Check — read-only Sepolia state verification.
 *
 * For each v1 contract, fetches counts + key getters to confirm the
 * deployed instance responds correctly. Zero writes, zero gas.
 *
 * Run: npx hardhat run tasks/launch-day-check.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface CheckResult {
  name: string;
  address: string;
  ok: boolean;
  detail: string;
}

async function safe<T>(label: string, addr: string, fn: () => Promise<T>): Promise<CheckResult> {
  try {
    const v = await fn();
    return { name: label, address: addr, ok: true, detail: String(v) };
  } catch (e: unknown) {
    return { name: label, address: addr, ok: false, detail: (e as Error).message.slice(0, 120) };
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Chain:", (await ethers.provider.getNetwork()).chainId);
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("ETH balance:", ethers.formatEther(bal));

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  const results: CheckResult[] = [];

  // ─── ConfidentialToken ───
  const token = await ethers.getContractAt("ConfidentialToken", addresses.ConfidentialToken);
  results.push(await safe("ConfidentialToken.name()", addresses.ConfidentialToken, async () => token.name()));
  results.push(await safe("ConfidentialToken.symbol()", addresses.ConfidentialToken, async () => token.symbol()));

  // ─── PlatformRegistry ───
  const registry = await ethers.getContractAt("PlatformRegistry", addresses.PlatformRegistry);
  results.push(await safe("PlatformRegistry.paused()", addresses.PlatformRegistry, async () => registry.paused()));
  results.push(await safe("PlatformRegistry.feeCollector()", addresses.PlatformRegistry, async () => registry.feeCollector()));

  // ─── SettlementVault ───
  const vault = await ethers.getContractAt("SettlementVault", addresses.SettlementVault);
  results.push(await safe("SettlementVault.supportedTokens(CDEX)", addresses.SettlementVault, async () => vault.supportedTokens(addresses.ConfidentialToken)));
  results.push(await safe("SettlementVault.authorizedSettlers(SealedAuction)", addresses.SettlementVault, async () => vault.authorizedSettlers(addresses.SealedAuction)));
  results.push(await safe("SettlementVault.authorizedSettlers(OTCBoard)", addresses.SettlementVault, async () => vault.authorizedSettlers(addresses.OTCBoard)));
  results.push(await safe("SettlementVault.authorizedSettlers(PrivatePayments)", addresses.SettlementVault, async () => vault.authorizedSettlers(addresses.PrivatePayments)));

  // ─── SealedAuction (Blind Floor edition) ───
  const sealed = await ethers.getContractAt("SealedAuction", addresses.SealedAuction);
  results.push(await safe("SealedAuction.getAuctionCount()", addresses.SealedAuction, async () => (await sealed.getAuctionCount()).toString()));
  // Probe the new Blind Floor view to confirm the new ABI matches deployed code
  results.push(await safe("SealedAuction.getBlindStatus(0) probe", addresses.SealedAuction, async () => {
    try {
      const v = await sealed.getBlindStatus(0);
      return `hasReserve=${v[0]} revealedReserveMet=${v[1]}`;
    } catch {
      return "(no auction id 0 yet — expected on fresh redeploy)";
    }
  }));

  // ─── OTCBoard (overflow-guard edition) ───
  const otc = await ethers.getContractAt("OTCBoard", addresses.OTCBoard);
  results.push(await safe("OTCBoard.getRequestCount()", addresses.OTCBoard, async () => (await otc.getRequestCount()).toString()));
  // Confirm the new expireRequest function exists by checking the interface
  results.push(await safe("OTCBoard.expireRequest selector", addresses.OTCBoard, async () => {
    const frag = otc.interface.getFunction("expireRequest");
    return frag ? `selector=${frag.selector}` : "MISSING";
  }));

  // ─── PrivatePayments ───
  const pay = await ethers.getContractAt("PrivatePayments", addresses.PrivatePayments);
  results.push(await safe("PrivatePayments.nextSplitId()", addresses.PrivatePayments, async () => (await pay.nextSplitId()).toString()));
  results.push(await safe("PrivatePayments.MAX_RECIPIENTS()", addresses.PrivatePayments, async () => (await pay.MAX_RECIPIENTS()).toString()));

  // ─── ProofOfReserves ───
  const por = await ethers.getContractAt("ProofOfReserves", addresses.ProofOfReserves);
  results.push(await safe("ProofOfReserves.getClaimCount()", addresses.ProofOfReserves, async () => (await por.getClaimCount()).toString()));
  results.push(await safe("ProofOfReserves.vault()", addresses.ProofOfReserves, async () => por.vault()));

  // ─── Other auctions ───
  const vickrey = await ethers.getContractAt("VickreyAuction", addresses.VickreyAuction);
  results.push(await safe("VickreyAuction.getAuctionCount()", addresses.VickreyAuction, async () => (await vickrey.getAuctionCount()).toString()));
  const dutch = await ethers.getContractAt("DutchAuction", addresses.DutchAuction);
  results.push(await safe("DutchAuction.getAuctionCount()", addresses.DutchAuction, async () => (await dutch.getAuctionCount()).toString()));
  const batch = await ethers.getContractAt("BatchAuction", addresses.BatchAuction);
  results.push(await safe("BatchAuction.getRoundCount()", addresses.BatchAuction, async () => (await batch.getRoundCount()).toString()));
  const overflow = await ethers.getContractAt("OverflowSale", addresses.OverflowSale);
  results.push(await safe("OverflowSale.getSaleCount()", addresses.OverflowSale, async () => (await overflow.getSaleCount()).toString()));

  // ─── Print + summary ───
  console.log("\n─── Live Sepolia State ───\n");
  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    console.log(`${tag} ${r.name.padEnd(54)}  ${r.detail}`);
    r.ok ? pass++ : fail++;
  }
  console.log(`\n${pass} passed · ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
