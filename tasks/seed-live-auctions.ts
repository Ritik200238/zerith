/**
 * Seed long-running sealed sales so the app and Quickstart always have something
 * open to bid on. The deployer deposits the MOCK lots into the vault, creates the
 * auctions (paid in CDEX, which the faucet hands out), and confirms each lot with
 * a Threshold-Network-signed decrypt so bidding opens.
 *
 * Run: npx hardhat run tasks/seed-live-auctions.ts --network ethSepolia
 *      LOTS="50000:30,12500:14" to choose lot sizes (whole tokens) and days.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const E6 = 1_000_000n;
// Operator approval for the vault: a short window, as Fhenix's FHERC20 docs advise
// (an operator can move the whole balance), not a permanent grant.
const approveUntil = async () => BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);

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
  const [seller] = await ethers.getSigners();
  const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"));
  const lots = (process.env.LOTS ?? "50000:30,12500:14").split(",").map((p) => {
    const [size, days] = p.split(":").map(Number);
    return { size: BigInt(size) * E6, seconds: days * 86400 };
  });

  const tip = BigInt(await provider.send("eth_maxPriorityFeePerGas", []));
  const baseFee = (await provider.getBlock("latest"))!.baseFeePerGas ?? 0n;
  const fees = { maxPriorityFeePerGas: tip * 2n, maxFeePerGas: baseFee * 3n + tip * 2n };

  const vault = await ethers.getContractAt("SettlementVault", A.SettlementVault, seller);
  const auction = await ethers.getContractAt("SealedAuction", A.SealedAuction, seller);
  const mock = await ethers.getContractAt("ConfidentialToken", A.MockToken, seller);
  const fhe = await loadCofhe(provider, seller);

  const total = lots.reduce((s, l) => s + l.size, 0n);
  await (await mock.setOperator(A.SettlementVault, await approveUntil(), fees)).wait();
  const [h, proof] = (await fhe.client
    .encryptInputs([fhe.Encryptable.uint64(total)])
    .setConsumingContract(A.SettlementVault)
    .execute()) as [string, string];
  let tx = await vault.deposit(A.MockToken, h, proof, fees);
  console.log(`deposit ${ethers.formatUnits(total, 6)} MOCK`, tx.hash);
  await tx.wait();

  for (const lot of lots) {
    const id = await auction.getAuctionCount();
    tx = await auction.createAuction(A.MockToken, A.ConfidentialToken, lot.size, lot.seconds, 0, fees);
    await tx.wait();
    const r = await publicDecryptWithRetry(fhe.client, BigInt(await auction.getLotFundedHandle(id)));
    const funded = typeof r.decryptedValue === "boolean" ? r.decryptedValue : BigInt(r.decryptedValue) === 1n;
    const c = await auction.confirmLot(id, funded, r.signature, fees);
    await c.wait();
    const a = await auction.getAuction(id);
    console.log(
      `auction #${id}: ${ethers.formatUnits(lot.size, 6)} MOCK, funded=${funded}, status=${a.status}, ` +
        `deadline ${new Date(Number(a.deadline) * 1000).toISOString()}`,
    );
    if (!funded) throw new Error("lot was not funded");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
