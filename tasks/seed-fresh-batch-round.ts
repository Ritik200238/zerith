/**
 * Deployer creates a fresh BatchAuction round so the UI burner can submit
 * buy/sell orders. Round #0 from prior session has expired.
 *
 * Run: npx hardhat run tasks/seed-fresh-batch-round.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const batch = await ethers.getContractAt("BatchAuction", addr.BatchAuction, deployer);
  const tx = await batch.createRound(addr.ConfidentialToken, addr.MockToken, 1200); // 20 min
  console.log("createRound tx:", tx.hash);
  await tx.wait();
  const id = (await batch.getRoundCount()) - 1n;
  console.log("Fresh roundId:", id.toString(), "duration = 20 min");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
