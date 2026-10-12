/**
 * Seed a fresh PENDING PoR claim from burner via Hardhat so the UI Reveal
 * driver has something to click on (both prior claims are now VERIFIED_TRUE).
 *
 * Run: npx hardhat run tasks/seed-fresh-por-claim.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const provider = ethers.provider;
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const por = await ethers.getContractAt("ProofOfReserves", addr.ProofOfReserves, burner);
  const tx = await por.requestProof(addr.ConfidentialToken, 1);
  console.log("tx:", tx.hash);
  await tx.wait();
  const count = await por.getClaimCount();
  console.log("new claim #" + (Number(count) - 1) + " seeded, total count:", count.toString());
}

main().then(() => process.exit(0));
