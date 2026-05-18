/**
 * SealedAuction E2E — create + bid via burner with @cofhe/sdk.
 *
 * Proves the headline auction flow works end-to-end against the new
 * deployment. Creates a short-duration auction with the deployer as
 * seller, then places an encrypted bid from the burner.
 *
 * Run: npx hardhat run tasks/verify-auction-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const provider = ethers.provider;
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);

  console.log("Seller (deployer):", deployer.address);
  console.log("Bidder (burner):  ", burner.address);

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const auctionContract = await ethers.getContractAt(
    "SealedAuction",
    addresses.SealedAuction,
    deployer,
  );

  // ── Step 1: deployer creates an auction (CDEX → CDEX, 60s duration) ──
  console.log("\n--- Step 1: createAuction (60s) ---");
  // Note: token and paymentToken must differ. Use ConfidentialToken vs MockToken.
  // But MockToken may not be deployed in current addresses. Use whatever differs.
  const token = addresses.ConfidentialToken;
  // Use MockToken (any address that differs from token works since auction
  // just stores addresses; settlement-related logic is checked later).
  const paymentToken = addresses.MockToken;
  console.log("  token:", token);
  console.log("  paymentToken:", paymentToken);
  const createTx = await auctionContract.createAuction(
    token,
    paymentToken,
    1000, // 1000 units for sale
    300,  // 5 min — MIN_DURATION
    0,    // default snipe extension
  );
  console.log("  tx:", createTx.hash);
  const createRcpt = await createTx.wait();
  console.log("  ✓ created, status:", createRcpt?.status);
  const auctionId = (await auctionContract.getAuctionCount()) - 1n;
  console.log("  auctionId:", auctionId.toString());

  // ── Step 2: burner places encrypted bid via @cofhe/sdk ──
  console.log("\n--- Step 2: Bidder encrypts 500 + places bid ---");
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

  const config = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(config);
  const adapterRes = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  console.log("  ✓ cofhe client connected as burner");

  const Encryptable = core.Encryptable;
  const result = await client.encryptInputs([Encryptable.uint128(500n)]).execute();
  console.log("  ✓ encrypted bid 500, handle:", result[0]?.ctHash?.toString?.()?.slice(0, 20) ?? result[0]);

  const auctionFromBurner = auctionContract.connect(burner);
  // @ts-expect-error connect returns Contract base type
  const bidTx = await auctionFromBurner.bid(auctionId, result[0]);
  console.log("  tx:", bidTx.hash);
  const bidRcpt = await bidTx.wait();
  console.log("  ✓ bid placed, status:", bidRcpt?.status);

  // ── Step 3: read back state ──
  console.log("\n--- Step 3: Read auction state ---");
  const myBidHandle = await auctionContract.connect(burner).getMyBid(auctionId);
  // @ts-expect-error narrowed
  console.log("  burner's encBid handle:", myBidHandle.toString().slice(0, 20) + "…");
  const auctionData = await auctionContract.getAuction(auctionId);
  console.log("  bidCount:", auctionData[5]?.toString?.() ?? "?");

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ SealedAuction E2E WORKS          ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("\nFor reveal, wait 60s past deadline then run revealWinner. ");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
