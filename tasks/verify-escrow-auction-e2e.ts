/**
 * Escrowed SealedAuction E2E on Sepolia, against the real CoFHE Threshold Network.
 *
 *   1. Seller (deployer) deposits the lot (MOCK) into the vault and creates an auction.
 *   2. confirmLot with a TN-signed decrypt of "lot funded" → OPEN.
 *   3. Two fresh burners claim CDEX, deposit 1000 each, and bid 300 / 450 (encrypted).
 *      A third burner with an EMPTY vault bids 5000 — it must not win.
 *   4. After the deadline, anyone closes; TN-signed reveal → winner = 450 bidder.
 *   5. settleAuction pays the seller from escrow; the loser and the empty bidder refund.
 *   6. Each party unseals their own vault balance with a permit to confirm the numbers.
 *
 * Run: npx hardhat run tasks/verify-escrow-auction-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const E6 = 1_000_000n;
// Operator approval for the vault: a short window, as Fhenix's FHERC20 docs advise
// (an operator can move the whole balance), not a permanent grant.
const approveUntil = async () => BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
const FHE_UINT64 = 5;
const DURATION = 300;

/** decryptForTx().withoutACP(), retrying while Fhenix hasn't yet seen the
 *  transaction that made the handle public (NOT_PUBLICLY_ALLOWED). */
async function publicDecryptWithRetry(client: any, handle: bigint) {
  const started = Date.now();
  for (;;) {
    try {
      return await client.decryptForTx(handle).withoutACP().execute();
    } catch (e: any) {
      if (e?.code !== "NOT_PUBLICLY_ALLOWED" || Date.now() - started > 45_000) throw e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

async function loadCofhe(provider: unknown, signer: unknown) {
  const base = path.join(__dirname, "..", "node_modules", "@cofhe", "sdk", "dist");
  const sdk = await import(path.join(base, "node.js"));
  const core = await import(path.join(base, "core.js"));
  const chains = await import(path.join(base, "chains.js"));
  const adapters = await import(path.join(base, "adapters.js"));
  const client = sdk.createCofheClient(sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] }));
  const a = await adapters.Ethers6Adapter(provider, signer);
  await client.connect(a.publicClient, a.walletClient);
  return { client, Encryptable: core.Encryptable };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = ethers.provider;
  const [seller] = await ethers.getSigners();
  const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"));

  const tip = BigInt(await provider.send("eth_maxPriorityFeePerGas", []));
  const baseFee = (await provider.getBlock("latest"))!.baseFeePerGas ?? 0n;
  const fees = { maxPriorityFeePerGas: tip * 2n, maxFeePerGas: baseFee * 3n + tip * 2n };

  const vault = await ethers.getContractAt("SettlementVault", A.SettlementVault, seller);
  const auction = await ethers.getContractAt("SealedAuction", A.SealedAuction, seller);
  const cdex = await ethers.getContractAt("ConfidentialToken", A.ConfidentialToken, seller);
  const mock = await ethers.getContractAt("ConfidentialToken", A.MockToken, seller);

  const sellerFhe = await loadCofhe(provider, seller);
  // CoFHE 1.0: inputs are bound to the consuming contract; returns [handle, signature].
  const enc64 = async (fhe: Awaited<ReturnType<typeof loadCofhe>>, v: bigint, consumer: string) =>
    (await fhe.client
      .encryptInputs([fhe.Encryptable.uint64(v)])
      .setConsumingContract(consumer)
      .execute()) as [string, string];
  const publicDecrypt = async (h: string | bigint) =>
    publicDecryptWithRetry(sellerFhe.client, BigInt(h));
  // Each party reads its own balance with its own client and ACP.
  const unsealBalance = async (w: ethers.Wallet, token: string) => {
    const h = await vault.getEncBalance(w.address, token);
    // A balance that was never written has no ciphertext (and no ACL entry): it is 0.
    if (BigInt(h) === 0n) return 0n;
    const fhe = await loadCofhe(provider, w);
    await fhe.client.acp.getOrCreateSelfACP();
    const r = await fhe.client.decryptForView(BigInt(h), FHE_UINT64).withACP().execute();
    return typeof r === "bigint" ? r : BigInt(r.decryptedValue ?? r.value ?? 0);
  };

  // ── 1. Seller deposits the lot and creates the auction ──
  const LOT = 2_000n * E6;
  console.log("Seller:", seller.address);
  await (await mock.setOperator(A.SettlementVault, await approveUntil(), fees)).wait();
  await (await vault.deposit(A.MockToken, ...(await enc64(sellerFhe, LOT, A.SettlementVault)), fees)).wait();
  const id = await auction.getAuctionCount();
  let tx = await auction.createAuction(A.MockToken, A.ConfidentialToken, LOT, DURATION, 0, fees);
  console.log("createAuction", id.toString(), tx.hash);
  await tx.wait();

  // ── 2. Confirm the lot via the Threshold Network ──
  const lotR = await publicDecrypt(await auction.getLotFundedHandle(id));
  const funded = typeof lotR.decryptedValue === "boolean" ? lotR.decryptedValue : BigInt(lotR.decryptedValue) === 1n;
  console.log("lot funded (TN):", funded);
  tx = await auction.confirmLot(id, funded, lotR.signature, fees);
  console.log("confirmLot", tx.hash);
  await tx.wait();
  const opened = await auction.getAuction(id);
  if (Number(opened.status) !== 0) throw new Error(`expected OPEN, got ${opened.status}`);

  // ── 3. Bidders ──
  type Bidder = { w: ethers.Wallet; fhe: Awaited<ReturnType<typeof loadCofhe>>; bid: bigint; deposit: bigint };
  const bidders: Bidder[] = [];
  for (const [bid, deposit] of [[300n * E6, 1_000n * E6], [450n * E6, 1_000n * E6], [5_000n * E6, 0n]] as const) {
    const w = ethers.Wallet.createRandom().connect(provider);
    await (await seller.sendTransaction({ to: w.address, value: ethers.parseEther("0.00005"), ...fees })).wait();
    const fhe = await loadCofhe(provider, w);
    if (deposit > 0n) {
      await (await cdex.connect(w).faucet(fees)).wait();
      await (await cdex.connect(w).setOperator(A.SettlementVault, await approveUntil(), fees)).wait();
      await (await vault.connect(w).deposit(A.ConfidentialToken, ...(await enc64(fhe, deposit, A.SettlementVault)), fees)).wait();
    }
    tx = await auction.connect(w).bid(id, ...(await enc64(fhe, bid, A.SealedAuction)), fees);
    console.log(`bid ${ethers.formatUnits(bid, 6)} from ${w.address} (vault ${ethers.formatUnits(deposit, 6)})`, tx.hash);
    await tx.wait();
    bidders.push({ w, fhe, bid, deposit });
    // Keep the throwaway keys so balances can be re-checked after the run.
    fs.appendFileSync(path.join(__dirname, "..", ".e2e-burners.json"),
      JSON.stringify({ auction: String(A.SealedAuction), id: String(id), address: w.address, privateKey: w.privateKey, bid: String(bid) }) + "\n");
  }
  const [low, high, empty] = bidders;

  // ── 4. Close after the deadline, reveal ──
  const deadline = Number((await auction.getAuction(id)).deadline);
  while (true) {
    const now = (await provider.getBlock("latest"))!.timestamp;
    if (now > deadline) break;
    console.log(`waiting ${deadline - now + 5}s for the deadline...`);
    await sleep((deadline - now + 5) * 1000);
  }
  tx = await auction.closeAuction(id, fees);
  console.log("closeAuction", tx.hash);
  await tx.wait();

  const [okH, bidH, winH] = await auction.getRevealHandles(id);
  const okR = await publicDecrypt(okH);
  const bidR = await publicDecrypt(bidH);
  const winR = await publicDecrypt(winH);
  const winner = ethers.getAddress("0x" + BigInt(winR.decryptedValue).toString(16).padStart(40, "0"));
  const saleOk = typeof okR.decryptedValue === "boolean" ? okR.decryptedValue : BigInt(okR.decryptedValue) === 1n;
  tx = await auction.reveal(id, saleOk, okR.signature, bidR.decryptedValue, bidR.signature, winner, winR.signature, fees);
  console.log("reveal", tx.hash, "→ winner", winner, "bid", ethers.formatUnits(BigInt(bidR.decryptedValue), 6));
  await tx.wait();
  if (winner !== high.w.address) throw new Error("wrong winner");
  if (BigInt(bidR.decryptedValue) !== high.bid) throw new Error("wrong winning bid");

  // ── 5. Settle + refunds ──
  tx = await auction.settleAuction(id, fees);
  console.log("settleAuction", tx.hash);
  await tx.wait();
  for (const b of [low, empty]) {
    tx = await auction.connect(b.w).claimRefund(id, fees);
    console.log("claimRefund", b.w.address, tx.hash);
    await tx.wait();
  }

  // ── 6. Each party unseals their own balance ──
  const fee = (high.bid * 200n) / 10_000n;
  const checks: [string, bigint, bigint][] = [
    ["winner CDEX", await unsealBalance(high.w, A.ConfidentialToken), high.deposit - high.bid],
    ["winner lot (MOCK)", await unsealBalance(high.w, A.MockToken), LOT],
    ["loser CDEX (refunded)", await unsealBalance(low.w, A.ConfidentialToken), low.deposit],
    ["empty bidder lot (MOCK)", await unsealBalance(empty.w, A.MockToken), 0n],
  ];
  let ok = true;
  for (const [label, got, want] of checks) {
    const pass = got === want;
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} ${label}: ${ethers.formatUnits(got, 6)} (expected ${ethers.formatUnits(want, 6)})`);
  }
  console.log(`seller should have received ${ethers.formatUnits(high.bid - fee, 6)} CDEX (fee ${ethers.formatUnits(fee, 6)})`);
  console.log("final status:", (await auction.getAuction(id)).status.toString(), "(3 = SETTLED)");
  if (!ok) throw new Error("balance checks failed");
  console.log("\nE2E PASSED on Sepolia");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
