/**
 * Creates a DEDICATED burner-funder hot wallet for the Try Instantly flow
 * on Vercel. This wallet's only job: receive a small Sepolia ETH stash
 * from the deployer, then fund tiny amounts (0.008 ETH each) to user
 * burners that hit /api/burner/create on the live site.
 *
 * Why dedicated (not the deployer key): anyone visiting the live site
 * can trigger /api/burner/create — if BURNER_FUNDER_PRIVATE_KEY === the
 * deployer key, a malicious visitor could drain it. With a dedicated
 * wallet holding only ~0.1 ETH, worst-case loss is bounded.
 *
 * Run with: npx hardhat run tasks/create-burner-funder.ts --network ethSepolia
 *
 * Output:
 *   - Prints the new hot-wallet PRIVATE KEY (capture it, then paste into Vercel)
 *   - Persists to .burner-funder.json (gitignored) for re-use
 *   - Funds the new wallet with 0.1 ETH from the deployer
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const FUND_AMOUNT_ETH = "0.03";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", ethers.formatEther(deployerBalance), "ETH");

  if (deployerBalance < ethers.parseEther(FUND_AMOUNT_ETH)) {
    throw new Error(`Deployer has < ${FUND_AMOUNT_ETH} ETH. Top it up first.`);
  }

  const funder = ethers.Wallet.createRandom();
  console.log("\n=== BURNER FUNDER WALLET ===");
  console.log("Address:    ", funder.address);
  console.log("Private key:", funder.privateKey);

  const out = {
    address: funder.address,
    privateKey: funder.privateKey,
    createdAt: new Date().toISOString(),
    fundedByTxHash: "" as string,
    purpose:
      "BURNER_FUNDER_PRIVATE_KEY for /api/burner/create on Vercel — paste this private key into Vercel env. Anyone hitting the live site's Try Instantly endpoint will drain small amounts (0.008 ETH each) from this wallet. Top up when low.",
  };

  console.log(`\nFunding hot wallet with ${FUND_AMOUNT_ETH} ETH from deployer...`);
  const tx = await deployer.sendTransaction({
    to: funder.address,
    value: ethers.parseEther(FUND_AMOUNT_ETH),
  });
  console.log("Fund tx hash:", tx.hash);
  await tx.wait();
  out.fundedByTxHash = tx.hash;

  const newBalance = await ethers.provider.getBalance(funder.address);
  console.log("Hot wallet balance:", ethers.formatEther(newBalance), "ETH");

  const outPath = path.join(__dirname, "..", ".burner-funder.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n✓ Saved to .burner-funder.json (gitignored).");
  console.log("\nNext: paste the private key into Vercel env as BURNER_FUNDER_PRIVATE_KEY for both `zerith` and `cipher-dex-5z83` projects.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
