/**
 * Redeploy BatchAuction with the new getEncClearingPrice view.
 * Re-authorizes as settler on vault and re-registers in registry.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Redeploy BatchAuction starting");
  console.log("Deployer:", deployer.address);

  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  const existing = JSON.parse(fs.readFileSync(addrPath, "utf8"));
  const vaultAddr = existing.SettlementVault;
  const registryAddr = existing.PlatformRegistry;

  const vault = await ethers.getContractAt("SettlementVault", vaultAddr);
  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);

  console.log("\n--- Deploying BatchAuction (with getEncClearingPrice view) ---");
  const Batch = await ethers.getContractFactory("BatchAuction");
  const batch = await Batch.deploy(vaultAddr, registryAddr, deployer.address);
  await batch.waitForDeployment();
  const batchAddr = await batch.getAddress();
  console.log("BatchAuction deployed to:", batchAddr);

  console.log("\n--- Authorizing as vault settler ---");
  await (await vault.addAuthorizedSettler(batchAddr)).wait();
  console.log("✓ authorized");

  console.log("\n--- Registering with PlatformRegistry ---");
  await (await registry.registerContract(batchAddr)).wait();
  console.log("✓ registered");

  const updated = {
    ...existing,
    BatchAuction: batchAddr,
    _deployedAt: "2026-05-11-batch-revealfix",
    _notes:
      (existing._notes || "") +
      " | 2026-05-11-batch-revealfix: redeployed BatchAuction with getEncClearingPrice view for full reveal-flow UI.",
  };
  fs.writeFileSync(addrPath, JSON.stringify(updated, null, 2));

  console.log("\n✓ BatchAuction redeployed at:", batchAddr);
  console.log("Update CONTRACTS.BatchAuction in frontend/src/lib/constants.ts");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
