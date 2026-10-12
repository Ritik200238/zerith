/**
 * Partial deploy: only the Wave-4 + Wave-5+ contracts on top of the
 * existing v2 baseline (Wave 3 redeploy from 2026-05-01).
 *
 * Reads the existing deployed-addresses.json, deploys:
 *   - Organization
 *   - EncryptedStreaming
 *   - ConfidentialMultisig
 *   - EncryptedRoyalty
 *
 * Then authorizes them as vault settlers and registers them with the
 * platform registry. Writes the full updated address map back to
 * deployed-addresses.json.
 *
 * Usage:
 *   npx hardhat run --network ethSepolia tasks/deploy-wave4-plus.ts
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface AddressMap {
  [k: string]: string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Partial deploy (Wave 4+) starting");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Read existing v2 addresses
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  const existing: AddressMap = JSON.parse(fs.readFileSync(addrPath, "utf8"));
  const vaultAddr = existing.SettlementVault;
  const registryAddr = existing.PlatformRegistry;
  if (!vaultAddr || !registryAddr) {
    throw new Error("Missing SettlementVault or PlatformRegistry in deployed-addresses.json");
  }
  console.log("Reusing SettlementVault:", vaultAddr);
  console.log("Reusing PlatformRegistry:", registryAddr);

  const vault = await ethers.getContractAt("SettlementVault", vaultAddr);
  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);

  // ─── Deploy ──────────────────────────────────────────────

  console.log("\n--- Deploying Organization ---");
  const Organization = await ethers.getContractFactory("Organization");
  const organization = await Organization.deploy(registryAddr);
  await organization.waitForDeployment();
  const organizationAddr = await organization.getAddress();
  console.log("Organization deployed to:", organizationAddr);

  console.log("\n--- Deploying EncryptedStreaming ---");
  const EncryptedStreaming = await ethers.getContractFactory("EncryptedStreaming");
  const streaming = await EncryptedStreaming.deploy(vaultAddr);
  await streaming.waitForDeployment();
  const streamingAddr = await streaming.getAddress();
  console.log("EncryptedStreaming deployed to:", streamingAddr);

  console.log("\n--- Deploying ConfidentialMultisig ---");
  const ConfidentialMultisig = await ethers.getContractFactory("ConfidentialMultisig");
  const multisig = await ConfidentialMultisig.deploy(vaultAddr);
  await multisig.waitForDeployment();
  const multisigAddr = await multisig.getAddress();
  console.log("ConfidentialMultisig deployed to:", multisigAddr);

  console.log("\n--- Deploying EncryptedRoyalty ---");
  const EncryptedRoyalty = await ethers.getContractFactory("EncryptedRoyalty");
  const royalty = await EncryptedRoyalty.deploy(vaultAddr);
  await royalty.waitForDeployment();
  const royaltyAddr = await royalty.getAddress();
  console.log("EncryptedRoyalty deployed to:", royaltyAddr);

  // ─── Authorize as vault settlers ────────────────────────
  // Organization does not move funds via vault directly, only the other 3.

  console.log("\n--- Authorizing settlers ---");
  await (await vault.addAuthorizedSettler(streamingAddr)).wait();
  console.log("✓ EncryptedStreaming");
  await (await vault.addAuthorizedSettler(multisigAddr)).wait();
  console.log("✓ ConfidentialMultisig");
  await (await vault.addAuthorizedSettler(royaltyAddr)).wait();
  console.log("✓ EncryptedRoyalty");

  // ─── Register with platform registry ────────────────────

  console.log("\n--- Registering with PlatformRegistry ---");
  await (await registry.registerContract(organizationAddr)).wait();
  console.log("✓ Organization");
  await (await registry.registerContract(streamingAddr)).wait();
  console.log("✓ EncryptedStreaming");
  await (await registry.registerContract(multisigAddr)).wait();
  console.log("✓ ConfidentialMultisig");
  await (await registry.registerContract(royaltyAddr)).wait();
  console.log("✓ EncryptedRoyalty");

  // ─── Persist ────────────────────────────────────────────

  const updated: AddressMap = {
    ...existing,
    Organization: organizationAddr,
    EncryptedStreaming: streamingAddr,
    ConfidentialMultisig: multisigAddr,
    EncryptedRoyalty: royaltyAddr,
    _deployedAt: "2026-05-02-w4-plus",
    _notes:
      (existing._notes || "") +
      " | 2026-05-02-w4-plus: added Organization, EncryptedStreaming, ConfidentialMultisig, EncryptedRoyalty (Wave 4 + W5+ contracts).",
  };

  fs.writeFileSync(addrPath, JSON.stringify(updated, null, 2));

  // ─── Summary ────────────────────────────────────────────

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  const spent = balance - finalBalance;
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         Wave 4+ Deployment Complete              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ Organization:         ${organizationAddr}`);
  console.log(`║ EncryptedStreaming:   ${streamingAddr}`);
  console.log(`║ ConfidentialMultisig: ${multisigAddr}`);
  console.log(`║ EncryptedRoyalty:     ${royaltyAddr}`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ ETH spent: ${ethers.formatEther(spent)}`);
  console.log(`║ ETH left:  ${ethers.formatEther(finalBalance)}`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\nAddresses persisted to deployed-addresses.json");
  console.log("\nNEXT: update CONTRACTS in cipherdex/frontend/src/lib/constants.ts");
  console.log("      with the four new addresses above.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("DEPLOY FAILED:", err);
    process.exit(1);
  });
