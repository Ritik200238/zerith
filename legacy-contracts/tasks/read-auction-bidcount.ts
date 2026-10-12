/**
 * Read a specific auction's bidCount for state-diff verification of a UI bid.
 * Usage: AUCTION_ID=3 npx hardhat run tasks/read-auction-bidcount.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const id = BigInt(process.env.AUCTION_ID ?? "3");
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const a = await ethers.getContractAt("SealedAuction", addr.SealedAuction);
  const data: any = await a.auctions(id);
  console.log(JSON.stringify({
    auctionId: id.toString(),
    seller: data[0],
    deadline: data[4].toString(),
    bidCount: data[6].toString(),
    status: data[11].toString(),
  }, null, 2));
}

main().then(() => process.exit(0));
