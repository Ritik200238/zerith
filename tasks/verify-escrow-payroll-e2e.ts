/**
 * Escrowed payroll + proof of reserves E2E on Sepolia, against the real CoFHE
 * Threshold Network.
 *
 *   1. A fresh "treasurer" wallet claims CDEX and deposits 1000 into the vault.
 *   2. Proof of reserves: proves balance >= 1000 (true) and >= 1001 (false), each
 *      published with a Threshold Network signature.
 *   3. Payroll: one split pays 120 / 80 to two fresh recipients. All amounts are
 *      encrypted in one batch; the contract locks the encrypted total (200).
 *   4. Recipient 1 claims; the treasurer cancels and gets recipient 2's 80 back.
 *   5. Each party unseals its own vault balance to confirm the numbers.
 *
 * Run: npx hardhat run tasks/verify-escrow-payroll-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const E6 = 1_000_000n;
// Operator approval for the vault: a short window, as Fhenix's FHERC20 docs advise
// (an operator can move the whole balance), not a permanent grant.
const approveUntil = async () => BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
const FHE_UINT64 = 5;

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

async function main() {
  const provider = ethers.provider;
  const [deployer] = await ethers.getSigners();
  const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"));

  const tip = BigInt(await provider.send("eth_maxPriorityFeePerGas", []));
  const baseFee = (await provider.getBlock("latest"))!.baseFeePerGas ?? 0n;
  const fees = { maxPriorityFeePerGas: tip * 2n, maxFeePerGas: baseFee * 3n + tip * 2n };

  const fresh = async (label: string) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    await (await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("0.00005"), ...fees })).wait();
    fs.appendFileSync(path.join(__dirname, "..", ".e2e-burners.json"),
      JSON.stringify({ e2e: "payroll", label, address: w.address, privateKey: w.privateKey }) + "\n");
    console.log(`${label}: ${w.address}`);
    return w;
  };

  const treasurer = await fresh("treasurer");
  const r1 = await fresh("recipient1");
  const r2 = await fresh("recipient2");

  const vault = await ethers.getContractAt("SettlementVault", A.SettlementVault, treasurer);
  const cdex = await ethers.getContractAt("ConfidentialToken", A.ConfidentialToken, treasurer);
  const payments = await ethers.getContractAt("PrivatePayments", A.PrivatePayments, treasurer);
  const por = await ethers.getContractAt("ProofOfReserves", A.ProofOfReserves, treasurer);
  const tFhe = await loadCofhe(provider, treasurer);

  // ── 1. Fund the treasurer's vault ──
  await (await cdex.faucet(fees)).wait();
  await (await cdex.setOperator(A.SettlementVault, await approveUntil(), fees)).wait();
  const [dh, dp] = (await tFhe.client
    .encryptInputs([tFhe.Encryptable.uint64(1_000n * E6)])
    .setConsumingContract(A.SettlementVault)
    .execute()) as [string, string];
  let tx = await vault.deposit(A.ConfidentialToken, dh, dp, fees);
  console.log("deposit 1000", tx.hash);
  await tx.wait();

  // ── 2. Proof of reserves (true, then false) ──
  for (const [threshold, expected] of [[1_000n * E6, 1n], [1_001n * E6, 2n]] as const) {
    const id = await por.getClaimCount();
    tx = await por.requestProof(A.ConfidentialToken, threshold, fees);
    await tx.wait();
    const claim = await por.claims(id);
    const r = await publicDecryptWithRetry(tFhe.client, BigInt(claim.encResult));
    const meets = typeof r.decryptedValue === "boolean" ? r.decryptedValue : BigInt(r.decryptedValue) === 1n;
    const reveal = await por.revealProof(id, meets, r.signature, fees);
    await reveal.wait();
    const status = (await por.getClaim(id)).status;
    console.log(`proof >= ${ethers.formatUnits(threshold, 6)}: status ${status} (1=true, 2=false) reveal ${reveal.hash}`);
    if (status !== expected) throw new Error("proof of reserves outcome mismatch");
  }

  // ── 3. Payroll split: 120 / 80, one encrypted batch ──
  const out = (await tFhe.client
    .encryptInputs([tFhe.Encryptable.uint64(120n * E6), tFhe.Encryptable.uint64(80n * E6)])
    .setConsumingContract(A.PrivatePayments)
    .execute()) as string[];
  const splitId = await payments.getSplitCount();
  tx = await payments.createSplit(A.ConfidentialToken, [r1.address, r2.address], out.slice(0, -1), out[out.length - 1], fees);
  console.log("createSplit", splitId.toString(), tx.hash);
  await tx.wait();

  // ── 4. Recipient 1 claims; treasurer cancels the rest ──
  tx = await payments.connect(r1).claim(splitId, fees);
  console.log("claim r1", tx.hash);
  await tx.wait();
  tx = await payments.cancelSplit(splitId, fees);
  console.log("cancelSplit", tx.hash);
  await tx.wait();

  // ── 5. Each party unseals its own balance with its own client and ACP ──
  const unseal = async (w: ethers.Wallet, handle: string) => {
    if (BigInt(handle) === 0n) return 0n; // never written → no ciphertext → 0
    const fhe = await loadCofhe(provider, w);
    await fhe.client.acp.getOrCreateSelfACP();
    const r = await fhe.client.decryptForView(BigInt(handle), FHE_UINT64).withACP().execute();
    return typeof r === "bigint" ? r : BigInt(r.decryptedValue ?? r.value ?? 0);
  };
  const checks: [string, bigint, bigint][] = [
    ["recipient 1 sees own amount", await unseal(r1, await payments.connect(r1).getMyAmount(splitId)), 120n * E6],
    ["recipient 1 vault (claimed)", await unseal(r1, await vault.getEncBalance(r1.address, A.ConfidentialToken)), 120n * E6],
    ["recipient 2 vault (cancelled)", await unseal(r2, await vault.getEncBalance(r2.address, A.ConfidentialToken)), 0n],
    ["treasurer vault (1000-120)", await unseal(treasurer, await vault.getEncBalance(treasurer.address, A.ConfidentialToken)), 880n * E6],
  ];
  let ok = true;
  for (const [label, got, want] of checks) {
    const pass = got === want;
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} ${label}: ${ethers.formatUnits(got, 6)} (expected ${ethers.formatUnits(want, 6)})`);
  }
  if (!ok) throw new Error("balance checks failed");
  console.log("\nPAYROLL + PROOF-OF-RESERVES E2E PASSED on Sepolia");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
