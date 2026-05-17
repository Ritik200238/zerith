/**
 * Targeted single-contract redeploy: SealedAuction.
 *
 * The contract gained the Blind Floor Auction feature (encrypted reserve
 * that never decrypts). Redeploys ONLY SealedAuction, re-grants required
 * roles (vault settler, AuctionClaim minter, Reputation caller, registry
 * registration), and updates deployed-addresses.json.
 *
 * NOTE: existing on-chain auctions on the OLD SealedAuction address are
 * orphaned. Acceptable on testnet.
 *
 * Run with: npx hardhat run tasks/deploy-sealed-auction.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying new SealedAuction from:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal === 0n) throw new Error("Deployer has zero balance.");

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const vaultAddr = addresses.SettlementVault;
  const registryAddr = addresses.PlatformRegistry;
  const claimAddr = addresses.AuctionClaim;
  const reputationAddr = addresses.Reputation;
  const oldSealed = addresses.SealedAuction;

  if (!vaultAddr || !registryAddr || !claimAddr) {
    throw new Error("Required dependency addresses missing from deployed-addresses.json");
  }
  console.log("Vault:        ", vaultAddr);
  console.log("Registry:     ", registryAddr);
  console.log("AuctionClaim: ", claimAddr);
  console.log("Reputation:   ", reputationAddr || "(none)");
  console.log("Old SealedAuction (will be orphaned):", oldSealed);

  // ─── Deploy ───
  console.log("\n--- Deploying new SealedAuction ---");
  const SealedAuction = await ethers.getContractFactory("SealedAuction");
  const sealed = await SealedAuction.deploy(vaultAddr, registryAddr, claimAddr);
  await sealed.waitForDeployment();
  const newSealedAddr = await sealed.getAddress();
  console.log("SealedAuction deployed to:", newSealedAddr);

  // ─── Grant settler on Vault ───
  console.log("\n--- Authorizing as vault settler ---");
  const vault = await ethers.getContractAt("SettlementVault", vaultAddr);
  try {
    const tx = await vault.addAuthorizedSettler(newSealedAddr);
    await tx.wait();
    console.log("Settler added. tx:", tx.hash);
  } catch (e: unknown) {
    console.warn("Settler add failed (already authorized?):", (e as Error).message.slice(0, 200));
  }

  // ─── Grant MINTER_ROLE on AuctionClaim ───
  console.log("\n--- Granting MINTER_ROLE on AuctionClaim ---");
  const claim = await ethers.getContractAt("AuctionClaim", claimAddr);
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  try {
    const tx = await claim.grantRole(MINTER_ROLE, newSealedAddr);
    await tx.wait();
    console.log("MINTER_ROLE granted. tx:", tx.hash);
  } catch (e: unknown) {
    console.warn("Minter grant failed:", (e as Error).message.slice(0, 200));
  }

  // ─── Register with Platform Registry ───
  console.log("\n--- Registering with PlatformRegistry ---");
  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);
  const alreadyRegistered = await registry.isRegisteredContract(newSealedAddr).catch(() => false);
  if (alreadyRegistered) {
    console.log("Already registered, skipping.");
  } else {
    const tx = await registry.registerContract(newSealedAddr);
    await tx.wait();
    console.log("Registered. tx:", tx.hash);
  }

  // ─── Authorize as Reputation caller ───
  if (reputationAddr) {
    console.log("\n--- Authorizing as Reputation caller ---");
    const reputation = await ethers.getContractAt("Reputation", reputationAddr);
    try {
      const tx = await reputation.addAuthorizedCaller(newSealedAddr);
      await tx.wait();
      console.log("Reputation caller added. tx:", tx.hash);
    } catch (e: unknown) {
      console.warn("Reputation add failed:", (e as Error).message.slice(0, 200));
    }
  }

  // ─── Persist address ───
  addresses.SealedAuction = newSealedAddr;
  addresses._deployedAt = new Date().toISOString().split("T")[0] + "-blind-floor";
  addresses._notes = (addresses._notes || "") + ` | ${addresses._deployedAt}: redeployed SealedAuction with Blind Floor (encrypted reserve never decrypts). Old: ${oldSealed}. New: ${newSealedAddr}.`;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("\n✓ New SealedAuction address written to deployed-addresses.json");
  console.log(`\nNext: update CONTRACTS.SealedAuction in frontend/src/lib/constants.ts to "${newSealedAddr}" and re-run \`npm run copy-abis\` in frontend.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
