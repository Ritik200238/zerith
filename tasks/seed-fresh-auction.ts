/**
 * Deployer creates a fresh 10-min Sealed Auction so the UI E2E driver has
 * an OPEN auction to bid on (the prior auctions are all CLOSED/REVEALED).
 *
 * Run: npx hardhat run tasks/seed-fresh-auction.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const auction = await ethers.getContractAt("SealedAuction", addr.SealedAuction, deployer);
  const tx = await auction.createAuction(
    addr.ConfidentialToken,
    addr.MockToken,
    1000,
    600,
    0,
  );
  console.log("Seed auction tx:", tx.hash);
  await tx.wait();
  const id = (await auction.getAuctionCount()) - 1n;
  console.log("Fresh auctionId:", id.toString(), "deadline = now + 600s");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
