/**
 * Creates a fresh burner wallet (random seed), funds it from the deployer
 * with a small amount of Sepolia ETH, prints the burner's private key and
 * mnemonic so Playwright can import it into MetaMask, then optionally
 * also mints some CDEX from the faucet on the new address.
 *
 * Run with: npx hardhat run tasks/create-burner.ts --network ethSepolia
 *
 * Safe to commit (no secrets baked in) — reads PRIVATE_KEY from .env at runtime.
 * Output is sensitive: do not paste anywhere except your own MetaMask import.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const FUND_AMOUNT_ETH = "0.03"; // enough for ~30 modest txs on Sepolia at typical gas

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", ethers.formatEther(deployerBalance), "ETH");

  if (deployerBalance < ethers.parseEther(FUND_AMOUNT_ETH)) {
    throw new Error(`Deployer has < ${FUND_AMOUNT_ETH} ETH. Top it up first.`);
  }

  // Fresh random burner
  const burner = ethers.Wallet.createRandom();
  console.log("\n=== BURNER WALLET (capture all three lines) ===");
  console.log("Address:    ", burner.address);
  console.log("Private key:", burner.privateKey);
  console.log("Mnemonic:   ", burner.mnemonic?.phrase);

  // Persist to a gitignored file so Playwright can read it
  const burnerJson = {
    address: burner.address,
    privateKey: burner.privateKey,
    mnemonic: burner.mnemonic?.phrase,
    createdAt: new Date().toISOString(),
    fundedByTxHash: "" as string,
  };

  // Fund
  console.log(`\nFunding burner with ${FUND_AMOUNT_ETH} ETH from deployer...`);
  const tx = await deployer.sendTransaction({
    to: burner.address,
    value: ethers.parseEther(FUND_AMOUNT_ETH),
  });
  console.log("Fund tx hash:", tx.hash);
  await tx.wait();
  burnerJson.fundedByTxHash = tx.hash;

  const newBalance = await ethers.provider.getBalance(burner.address);
  console.log("Burner balance:", ethers.formatEther(newBalance), "ETH");

  // Persist
  const outPath = path.join(__dirname, "..", ".burner-wallet.json");
  fs.writeFileSync(outPath, JSON.stringify(burnerJson, null, 2));
  console.log("\n✓ Saved to .burner-wallet.json (gitignored). Playwright reads this.");
  console.log("\nNext: paste the mnemonic into MetaMask Import Wallet in the Playwright session.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
