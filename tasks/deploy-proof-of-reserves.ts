/**
 * Targeted single-contract deploy: ProofOfReserves.
 *
 * Reads existing SettlementVault + PlatformRegistry addresses from
 * deployed-addresses.json (preserves the live system), deploys
 * ProofOfReserves against them, registers with the registry, and
 * appends the new address to deployed-addresses.json.
 *
 * Run with: npx hardhat run tasks/deploy-proof-of-reserves.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ProofOfReserves from:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal === 0n) throw new Error("Deployer has zero balance. Fund the account first.");

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error(`deployed-addresses.json not found at ${addressesPath}`);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const vaultAddr = addresses.SettlementVault;
  const registryAddr = addresses.PlatformRegistry;
  if (!vaultAddr || !registryAddr) {
    throw new Error("SettlementVault or PlatformRegistry missing from deployed-addresses.json");
  }
  console.log("Using SettlementVault:", vaultAddr);
  console.log("Using PlatformRegistry:", registryAddr);

  if (addresses.ProofOfReserves && addresses.ProofOfReserves !== "0x0000000000000000000000000000000000000000") {
    console.warn(`WARNING: ProofOfReserves already deployed at ${addresses.ProofOfReserves}. Continuing will overwrite — Ctrl+C to abort within 5 seconds.`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n--- Deploying ProofOfReserves ---");
  const ProofOfReserves = await ethers.getContractFactory("ProofOfReserves");
  const por = await ProofOfReserves.deploy(vaultAddr, registryAddr);
  await por.waitForDeployment();
  const porAddr = await por.getAddress();
  console.log("ProofOfReserves deployed to:", porAddr);

  console.log("\n--- Registering with PlatformRegistry ---");
  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);
  const alreadyRegistered = await registry.isRegisteredContract(porAddr).catch(() => false);
  if (alreadyRegistered) {
    console.log("Already registered, skipping.");
  } else {
    const tx = await registry.registerContract(porAddr);
    console.log("registerContract tx:", tx.hash);
    await tx.wait();
    console.log("Registered.");
  }

  addresses.ProofOfReserves = porAddr;
  // Bump the timestamp marker so the frontend cache busters notice
  addresses._deployedAt = new Date().toISOString().split("T")[0] + "-por-deploy";
  addresses._notes = (addresses._notes || "") + ` | ${addresses._deployedAt}: deployed ProofOfReserves at ${porAddr}.`;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("\n✓ ProofOfReserves address written to deployed-addresses.json");
  console.log(`\nNext: update CONTRACTS.ProofOfReserves in frontend/src/lib/constants.ts to "${porAddr}" and run \`npm run copy-abis\` in frontend.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
