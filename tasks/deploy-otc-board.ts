/**
 * Targeted single-contract redeploy: OTCBoard.
 *
 * Adds encrypted overflow guard on the euint128→euint64 settlement cast
 * (audit Tier-2 truncation bug) and a permissionless `expireRequest`
 * sweep function so the EXPIRED status is reachable on-chain.
 *
 * Run with: npx hardhat run tasks/deploy-otc-board.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying new OTCBoard from:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal === 0n) throw new Error("Deployer has zero balance.");

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const vaultAddr = addresses.SettlementVault;
  const registryAddr = addresses.PlatformRegistry;
  const reputationAddr = addresses.Reputation;
  const oldOtc = addresses.OTCBoard;
  if (!vaultAddr || !registryAddr) {
    throw new Error("Required dependency addresses missing from deployed-addresses.json");
  }
  console.log("Vault:      ", vaultAddr);
  console.log("Registry:   ", registryAddr);
  console.log("Reputation: ", reputationAddr || "(none)");
  console.log("Old OTCBoard (will be orphaned):", oldOtc);

  console.log("\n--- Deploying new OTCBoard ---");
  const OTCBoard = await ethers.getContractFactory("OTCBoard");
  const otc = await OTCBoard.deploy(vaultAddr, registryAddr);
  await otc.waitForDeployment();
  const newOtcAddr = await otc.getAddress();
  console.log("OTCBoard deployed to:", newOtcAddr);

  console.log("\n--- Authorizing as vault settler ---");
  const vault = await ethers.getContractAt("SettlementVault", vaultAddr);
  try {
    const tx = await vault.addAuthorizedSettler(newOtcAddr);
    await tx.wait();
    console.log("Settler added. tx:", tx.hash);
  } catch (e: unknown) {
    console.warn("Settler add failed:", (e as Error).message.slice(0, 200));
  }

  console.log("\n--- Registering with PlatformRegistry ---");
  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);
  const alreadyRegistered = await registry.isRegisteredContract(newOtcAddr).catch(() => false);
  if (alreadyRegistered) {
    console.log("Already registered, skipping.");
  } else {
    const tx = await registry.registerContract(newOtcAddr);
    await tx.wait();
    console.log("Registered. tx:", tx.hash);
  }

  if (reputationAddr) {
    console.log("\n--- Authorizing as Reputation caller ---");
    const reputation = await ethers.getContractAt("Reputation", reputationAddr);
    try {
      const tx = await reputation.addAuthorizedCaller(newOtcAddr);
      await tx.wait();
      console.log("Reputation caller added. tx:", tx.hash);
    } catch (e: unknown) {
      console.warn("Reputation add failed:", (e as Error).message.slice(0, 200));
    }
  }

  addresses.OTCBoard = newOtcAddr;
  addresses._deployedAt = new Date().toISOString().split("T")[0] + "-otc-overflow-fix";
  addresses._notes = (addresses._notes || "") + ` | ${addresses._deployedAt}: redeployed OTCBoard with encrypted overflow guard + expireRequest. Old: ${oldOtc}. New: ${newOtcAddr}.`;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("\n✓ New OTCBoard address written to deployed-addresses.json");
  console.log(`\nNext: update CONTRACTS.OTCBoard in frontend/src/lib/constants.ts to "${newOtcAddr}" and re-run \`npm run copy-abis\` in frontend.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
