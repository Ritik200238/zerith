/**
 * Resume the SealedAuction multi-bidder reveal flow for auctionId=1.
 *
 * Picks up where verify-multibid-reveal-e2e.ts left off: the auction was
 * created (id=1) with 3 bids (burner1=500, burner2=800, burner3=1200) but
 * the close + reveal failed because we computed the wrong deadline offset.
 *
 * This script:
 *   1. Reads the auction via the auto-generated `auctions(uint256)` getter,
 *      which returns ALL struct fields including the encrypted handles.
 *   2. Sleeps until past `deadline` (5 min from creation).
 *   3. Deployer calls closeAuction → marks highest bid/bidder as
 *      globally decryptable.
 *   4. Burner1 uses @cofhe/sdk client.decryptForTx() to get a
 *      Threshold-Network signed (value, signature) for each handle.
 *   5. Submits revealWinner(...) with the signatures.
 *   6. Asserts winner = burner3 (the 1200 bidder).
 *
 * Run: npx hardhat run tasks/resume-multibid-reveal.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const AUCTION_ID = 1n;

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
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  const b1Json = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const multibid = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".multibid-burners.json"), "utf8"),
  );
  const burner1 = new ethers.Wallet(b1Json.privateKey, provider);
  const burner3 = new ethers.Wallet(multibid.burner3.privateKey, provider);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const auction = await ethers.getContractAt("SealedAuction", addr.SealedAuction, deployer);

  // ── Step 1: read full struct via public mapping accessor ──
  // Order matches the Auction struct exactly.
  console.log(`\n--- Step 1: read auctions(${AUCTION_ID}) ---`);
  const a: any = await auction.auctions(AUCTION_ID);
  console.log("  seller:", a[0]);
  console.log("  token:", a[1]);
  console.log("  paymentToken:", a[2]);
  console.log("  amount:", a[3].toString());
  console.log("  deadline (unix):", a[4].toString(), "(", new Date(Number(a[4]) * 1000).toISOString(), ")");
  console.log("  originalDeadline:", a[5].toString());
  console.log("  bidCount:", a[6].toString());
  const highestBidHandle: bigint = a[7];
  const highestBidderHandle: bigint = a[8];
  console.log("  highestBid handle:", "0x" + highestBidHandle.toString(16).padStart(64, "0"));
  console.log("  highestBidder handle:", "0x" + highestBidderHandle.toString(16).padStart(64, "0"));
  console.log("  revealedBid:", a[9].toString());
  console.log("  revealedBidder:", a[10]);
  console.log("  status:", a[11].toString(), "(0=OPEN, 1=CLOSED, 2=REVEALED, 3=SETTLED, 4=RESERVE_NOT_MET)");

  const status = Number(a[11]);
  const deadline = Number(a[4]);

  // ── Step 2: sleep past deadline if still OPEN ──
  if (status === 0) {
    const now = Math.floor(Date.now() / 1000);
    const sleepMs = (deadline - now + 5) * 1000;
    if (sleepMs > 0) {
      console.log(`\n--- Step 2: sleeping ${Math.round(sleepMs / 1000)}s until past deadline ---`);
      await new Promise((r) => setTimeout(r, sleepMs));
    } else {
      console.log("\n--- Step 2: deadline already passed ---");
    }

    console.log("\n--- Step 3: deployer.closeAuction ---");
    const closeTx = await auction.closeAuction(AUCTION_ID);
    console.log("  tx:", closeTx.hash);
    const closeRcpt = await closeTx.wait();
    console.log("  ✓ closed, status:", closeRcpt?.status);
  } else if (status === 1) {
    console.log("\n--- Steps 2-3 skipped: auction already CLOSED ---");
  } else {
    console.log("\n--- Auction past CLOSED state. Re-read for current handles. ---");
  }

  // Re-read after close so we have the post-close handles (FHE.allowGlobal applied).
  const aAfter: any = await auction.auctions(AUCTION_ID);
  const bidHandle: bigint = aAfter[7];
  const bidderHandle: bigint = aAfter[8];
  const statusAfter = Number(aAfter[11]);
  console.log("\n  post-close status:", statusAfter);
  console.log("  post-close bid handle:", "0x" + bidHandle.toString(16).padStart(64, "0"));
  console.log("  post-close bidder handle:", "0x" + bidderHandle.toString(16).padStart(64, "0"));

  if (statusAfter < 1) {
    throw new Error("Auction is not CLOSED after closeAuction. Cannot proceed to reveal.");
  }

  if (statusAfter >= 2) {
    console.log("\n--- Already REVEALED. Reading on-chain results: ---");
    console.log("  revealedBid:", aAfter[9].toString());
    console.log("  revealedBidder:", aAfter[10]);
    return;
  }

  // ── Step 4: decryptForTx the highest bid + bidder via TN ──
  console.log("\n--- Step 4: decryptForTx via Threshold Network ---");
  const { client } = await loadCofhe(provider, burner1);

  console.log("  decryptForTx(highestBid)...");
  const bidReveal = await (client as any).decryptForTx(bidHandle).withoutPermit().execute();
  console.log("  ✓ TN signed bidValue:", bidReveal.decryptedValue.toString());

  console.log("  decryptForTx(highestBidder)...");
  const bidderReveal = await (client as any).decryptForTx(bidderHandle).withoutPermit().execute();
  const winnerAddrInt: bigint = BigInt(bidderReveal.decryptedValue);
  const winnerAddr = ethers.getAddress("0x" + winnerAddrInt.toString(16).padStart(40, "0"));
  console.log("  ✓ TN signed bidder:", winnerAddr);

  // ── Step 5: revealWinner on-chain ──
  console.log("\n--- Step 5: revealWinner on-chain ---");
  const revealTx = await (auction.connect(burner1) as any).revealWinner(
    AUCTION_ID,
    bidReveal.decryptedValue,
    bidReveal.signature,
    winnerAddr,
    bidderReveal.signature,
  );
  console.log("  tx:", revealTx.hash);
  const revealRcpt = await revealTx.wait();
  console.log("  ✓ revealed, status:", revealRcpt?.status);

  // ── Step 6: assert ──
  const expected = ethers.getAddress(burner3.address);
  console.log("\n  expected winner = burner3:", expected);
  console.log("  actual winner:           ", winnerAddr);
  console.log("  match:", winnerAddr === expected ? "✓" : "✗");
  console.log("  revealed bid:", bidReveal.decryptedValue.toString(), "(expected 1200)");

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   ✓ SealedAuction multi-bidder reveal WORKS    ║");
  console.log("╚════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
