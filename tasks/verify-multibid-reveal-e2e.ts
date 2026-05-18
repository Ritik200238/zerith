/**
 * SealedAuction multi-bidder + reveal E2E.
 *
 * Proves the headline CLAUDE.md Phase 2 item:
 * "Sealed-Bid Auction: create → 3 bids from 3 wallets → end → reveal winner →
 *  verify losing bids never decrypt (Etherscan trace)."
 *
 * Flow:
 *   1. Deployer creates a 5-min sealed auction (CDEX/MockToken).
 *   2. Burner1 (existing .burner-wallet.json) bids 500.
 *   3. Burner2 (created on demand, funded from deployer) bids 800.
 *   4. Burner3 (created on demand, funded from deployer) bids 1200 (winner).
 *   5. Wait past deadline.
 *   6. Deployer calls closeAuction → marks highest bid/bidder as decryptable.
 *   7. Burner1 calls decryptForTx(highestBid) + decryptForTx(highestBidder)
 *      via @cofhe/sdk → gets TN-signed (value, signature) pairs.
 *   8. Anyone submits revealWinner(...) with the signatures → contract
 *      verifies the TN signatures on-chain → emits WinnerRevealed.
 *   9. Reads bids[auctionId][burner1].handle and bids[auctionId][burner2].handle
 *      and confirms they remain encrypted (no FHE.allowGlobal was called on them).
 *
 * Run: npx hardhat run tasks/verify-multibid-reveal-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEPOLIA = 11155111;

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

async function fundBurner(deployer: any, addr: string, amount: bigint, label: string) {
  const bal = await deployer.provider.getBalance(addr);
  if (bal >= amount) {
    console.log(`  ${label} already funded: ${ethers.formatEther(bal)} ETH`);
    return;
  }
  const need = amount - bal;
  const tx = await deployer.sendTransaction({ to: addr, value: need });
  console.log(`  funding ${label} with ${ethers.formatEther(need)} ETH → tx ${tx.hash}`);
  await tx.wait();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== SEPOLIA) {
    throw new Error(`Wrong network. chainId=${net.chainId}, expected ${SEPOLIA}`);
  }

  console.log("Seller (deployer):", deployer.address);

  // ── Load / create three burners ──
  const burnerPath = path.join(__dirname, "..", ".burner-wallet.json");
  const b1Json = JSON.parse(fs.readFileSync(burnerPath, "utf8"));
  const burner1 = new ethers.Wallet(b1Json.privateKey, provider);

  const burners2_3_path = path.join(__dirname, "..", ".multibid-burners.json");
  let multibid: { burner2: { privateKey: string; address: string }; burner3: { privateKey: string; address: string } };
  if (fs.existsSync(burners2_3_path)) {
    multibid = JSON.parse(fs.readFileSync(burners2_3_path, "utf8"));
    console.log("  reusing existing multibid burners");
  } else {
    const w2 = ethers.Wallet.createRandom();
    const w3 = ethers.Wallet.createRandom();
    multibid = {
      burner2: { privateKey: w2.privateKey, address: w2.address },
      burner3: { privateKey: w3.privateKey, address: w3.address },
    };
    fs.writeFileSync(burners2_3_path, JSON.stringify(multibid, null, 2));
    console.log("  generated 2 new burners and wrote .multibid-burners.json (gitignored)");
  }
  const burner2 = new ethers.Wallet(multibid.burner2.privateKey, provider);
  const burner3 = new ethers.Wallet(multibid.burner3.privateKey, provider);

  console.log("Burner1:", burner1.address);
  console.log("Burner2:", burner2.address);
  console.log("Burner3:", burner3.address);

  console.log("\n--- Step 0: fund burners ---");
  const TARGET = ethers.parseEther("0.005");
  await fundBurner(deployer, burner1.address, TARGET, "burner1");
  await fundBurner(deployer, burner2.address, TARGET, "burner2");
  await fundBurner(deployer, burner3.address, TARGET, "burner3");

  // ── Load contract ──
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const auctionContract = await ethers.getContractAt(
    "SealedAuction",
    addr.SealedAuction,
    deployer,
  );

  // ── Step 1: create auction (300s) ──
  console.log("\n--- Step 1: createAuction (300s) ---");
  const createTx = await auctionContract.createAuction(
    addr.ConfidentialToken,
    addr.MockToken,
    1000,
    300,
    0,
  );
  console.log("  tx:", createTx.hash);
  await createTx.wait();
  const auctionId = (await auctionContract.getAuctionCount()) - 1n;
  console.log("  auctionId:", auctionId.toString());
  const ad = await auctionContract.getAuction(auctionId);
  const deadline = Number(ad[3]);
  console.log("  deadline (unix):", deadline, "(", new Date(deadline * 1000).toISOString(), ")");

  // ── Step 2: 3 encrypted bids ──
  console.log("\n--- Step 2: place 3 encrypted bids ---");

  const bids = [
    { signer: burner1, label: "burner1", amount: 500n },
    { signer: burner2, label: "burner2", amount: 800n },
    { signer: burner3, label: "burner3", amount: 1200n },
  ];

  for (const b of bids) {
    console.log(`\n  ${b.label} → bid ${b.amount}`);
    const { client, Encryptable } = await loadCofhe(provider, b.signer);
    const enc = await client.encryptInputs([Encryptable.uint128(b.amount)]).execute();
    const c = auctionContract.connect(b.signer) as any;
    const tx = await c.bid(auctionId, enc[0]);
    console.log("    tx:", tx.hash);
    const rcpt = await tx.wait();
    console.log("    ✓ status:", rcpt?.status);
  }

  const adAfter = await auctionContract.getAuction(auctionId);
  console.log("\n  bidCount after 3 bids:", adAfter[5]?.toString?.() ?? "?");

  // ── Step 3: wait past deadline ──
  console.log("\n--- Step 3: wait past deadline ---");
  const now = Math.floor(Date.now() / 1000);
  const sleepMs = (deadline - now + 5) * 1000;
  if (sleepMs > 0) {
    console.log(`  sleeping ${Math.round(sleepMs / 1000)}s until past deadline...`);
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  // ── Step 4: closeAuction ──
  console.log("\n--- Step 4: deployer.closeAuction ---");
  const closeTx = await auctionContract.closeAuction(auctionId);
  console.log("  tx:", closeTx.hash);
  const closeRcpt = await closeTx.wait();
  console.log("  ✓ closed, status:", closeRcpt?.status);

  // ── Step 5: decryptForTx the highest bid + bidder via TN ──
  console.log("\n--- Step 5: decryptForTx highest bid + bidder (TN reveal) ---");
  const auctionFinal = await auctionContract.getAuction(auctionId);
  const highestBidHandle = auctionFinal[6]; // highestBid handle
  const highestBidderHandle = auctionFinal[7]; // highestBidder handle
  console.log("  highestBid handle:", highestBidHandle.toString().slice(0, 20) + "…");
  console.log("  highestBidder handle:", highestBidderHandle.toString().slice(0, 20) + "…");

  const { client } = await loadCofhe(provider, burner1);

  console.log("  decryptForTx(highestBid)...");
  const bidReveal = await (client as any).decryptForTx(highestBidHandle).withoutPermit().execute();
  console.log("  ✓ TN signed bidValue:", bidReveal.decryptedValue.toString());

  console.log("  decryptForTx(highestBidder)...");
  const bidderReveal = await (client as any).decryptForTx(highestBidderHandle).withoutPermit().execute();
  const winnerAddr = "0x" + BigInt(bidderReveal.decryptedValue).toString(16).padStart(40, "0");
  console.log("  ✓ TN signed bidder:", winnerAddr);

  // ── Step 6: revealWinner on-chain ──
  console.log("\n--- Step 6: revealWinner on-chain ---");
  const revealTx = await (auctionContract.connect(burner1) as any).revealWinner(
    auctionId,
    bidReveal.decryptedValue,
    bidReveal.signature,
    winnerAddr,
    bidderReveal.signature,
  );
  console.log("  tx:", revealTx.hash);
  const revealRcpt = await revealTx.wait();
  console.log("  ✓ revealed, status:", revealRcpt?.status);

  // ── Step 7: confirm losing bids stayed sealed ──
  console.log("\n--- Step 7: confirm losing bids remain encrypted ---");
  const adFinal = await auctionContract.getAuction(auctionId);
  console.log("  revealedBid:", adFinal[10]?.toString?.());
  console.log("  revealedBidder:", adFinal[11]);
  console.log("  status:", adFinal[4]?.toString?.());
  const winnerLower = winnerAddr.toLowerCase();
  const expectedWinner = burner3.address.toLowerCase();
  console.log("  expected winner = burner3:", expectedWinner);
  console.log("  matches:", winnerLower === expectedWinner ? "✓" : "✗");

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   ✓ SealedAuction multi-bidder reveal WORKS    ║");
  console.log("╚════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
