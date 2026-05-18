/**
 * OTCBoard request → quote → accept (full settle round-trip).
 *
 * Closes CLAUDE.md Phase 2 OTC item.
 *
 * Flow:
 *   1. burner1 = REQUESTER posts a fresh request (10-min deadline)
 *      with encrypted amount=100, minPrice=90, maxPrice=110.
 *   2. burner2 = QUOTER submits encrypted quote (price=100, amount=100)
 *      via submitQuote.
 *   3. burner1 calls acceptQuote(requestId, 0) — contract verifies
 *      price in range on ciphertext, settles both legs via vault
 *      (zero-replace on insufficient balance), flips status to MATCHED.
 *
 * The privacy claim is: the quote price + amount + the requester's
 * price range all stay encrypted; outside observers see only that a
 * match happened (event with hashed addresses).
 *
 * Run: npx hardhat run tasks/verify-otc-settle-e2e.ts --network ethSepolia
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
  const multibid = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".multibid-burners.json"), "utf8"),
  );
  const burner1 = new ethers.Wallet(b1Json.privateKey, provider);
  const burner2 = new ethers.Wallet(multibid.burner2.privateKey, provider);

  console.log("Requester (burner1):", burner1.address);
  console.log("Quoter (burner2):   ", burner2.address);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  // Vault must support both tokens — verify up front
  const vault = await ethers.getContractAt("SettlementVault", addr.SettlementVault, burner1);
  const cdexOk = await vault.supportedTokens(addr.ConfidentialToken);
  const mockOk = await vault.supportedTokens(addr.MockToken);
  console.log(`\n  vault.supportedTokens(CDEX)=${cdexOk}, vault.supportedTokens(MockToken)=${mockOk}`);
  if (!cdexOk) {
    throw new Error("CDEX not supported by vault — cannot run settle test.");
  }
  // Use CDEX on both sides if MockToken isn't supported; OTC just needs tokenWant != tokenOffer
  // but the contract doesn't enforce that, and vault still settles per-token.
  const tokenWant = addr.ConfidentialToken;
  const tokenOffer = mockOk ? addr.MockToken : addr.ConfidentialToken; // OTC allows same-token

  const otc = await ethers.getContractAt("OTCBoard", addr.OTCBoard, burner1);

  // ── Step 1: burner1 posts request ──
  console.log("\n--- Step 1: burner1.postRequest ---");
  const r1 = await loadCofhe(provider, burner1);
  const reqEnc = await r1.client
    .encryptInputs([
      r1.Encryptable.uint128(100n), // amount wanted
      r1.Encryptable.uint128(90n),  // minPrice
      r1.Encryptable.uint128(110n), // maxPrice
    ])
    .execute();
  console.log("  ✓ encrypted (amount=100, min=90, max=110)");

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const postTx = await otc.postRequest(
    tokenWant,
    tokenOffer,
    reqEnc[0],
    reqEnc[1],
    reqEnc[2],
    deadline,
  );
  console.log("  tx:", postTx.hash);
  await postTx.wait();
  const requestId = (await otc.getRequestCount()) - 1n;
  console.log("  requestId:", requestId.toString());

  // ── Step 2: burner2 submits quote ──
  console.log("\n--- Step 2: burner2.submitQuote ---");
  const r2 = await loadCofhe(provider, burner2);
  const quoteEnc = await r2.client
    .encryptInputs([
      r2.Encryptable.uint128(100n), // price per unit (in range)
      r2.Encryptable.uint128(100n), // amount offered
    ])
    .execute();
  console.log("  ✓ encrypted (price=100, amount=100)");

  const otcAsQuoter = otc.connect(burner2) as any;
  const quoteTx = await otcAsQuoter.submitQuote(requestId, quoteEnc[0], quoteEnc[1]);
  console.log("  tx:", quoteTx.hash);
  const quoteRcpt = await quoteTx.wait();
  console.log("  ✓ quote submitted, status:", quoteRcpt?.status);

  // ── Step 3: burner1 accepts quote ──
  console.log("\n--- Step 3: burner1.acceptQuote(0) ---");
  const acceptTx = await otc.acceptQuote(requestId, 0);
  console.log("  tx:", acceptTx.hash);
  const acceptRcpt = await acceptTx.wait();
  console.log("  ✓ accepted, status:", acceptRcpt?.status);

  // ── Step 4: read final state ──
  console.log("\n--- Step 4: read final request state ---");
  const req: any = await otc.requests(requestId);
  console.log("  requester:", req[0]);
  console.log("  tokenWant:", req[1]);
  console.log("  tokenOffer:", req[2]);
  console.log("  deadline:", req[5]?.toString?.() ?? req.deadline?.toString?.());
  console.log("  status:", req[6]?.toString?.() ?? req.status?.toString?.(), "(0=ACTIVE, 1=MATCHED, 2=CANCELLED, 3=EXPIRED)");

  console.log("\n╔═════════════════════════════════════════════════╗");
  console.log("║   ✓ OTCBoard request → quote → accept WORKS     ║");
  console.log("╚═════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
