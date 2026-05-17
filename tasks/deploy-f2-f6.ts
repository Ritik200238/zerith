/**
 * Partial deploy: ConfidentialWrapper (F2) + EncryptedRaffle (F6).
 *
 * Both are standalone contracts that don't need vault settler authorization
 * (the wrapper holds its own ERC-20 deposits; the raffle holds its own
 * ticket payments). They DO get registered with PlatformRegistry for
 * discoverability.
 *
 * Usage:
 *   npx hardhat run --network ethSepolia tasks/deploy-f2-f6.ts
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("F2 + F6 deploy starting");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  const existing = JSON.parse(fs.readFileSync(addrPath, "utf8"));
  const registryAddr = existing.PlatformRegistry;
  if (!registryAddr) throw new Error("PlatformRegistry missing");

  const registry = await ethers.getContractAt("PlatformRegistry", registryAddr);

  console.log("\n--- Deploying ConfidentialWrapper ---");
  const Wrapper = await ethers.getContractFactory("ConfidentialWrapper");
  const wrapper = await Wrapper.deploy();
  await wrapper.waitForDeployment();
  const wrapperAddr = await wrapper.getAddress();
  console.log("ConfidentialWrapper deployed to:", wrapperAddr);

  console.log("\n--- Deploying EncryptedRaffle ---");
  const Raffle = await ethers.getContractFactory("EncryptedRaffle");
  const raffle = await Raffle.deploy();
  await raffle.waitForDeployment();
  const raffleAddr = await raffle.getAddress();
  console.log("EncryptedRaffle deployed to:", raffleAddr);

  console.log("\n--- Registering with PlatformRegistry ---");
  await (await registry.registerContract(wrapperAddr)).wait();
  console.log("✓ ConfidentialWrapper registered");
  await (await registry.registerContract(raffleAddr)).wait();
  console.log("✓ EncryptedRaffle registered");

  const updated = {
    ...existing,
    ConfidentialWrapper: wrapperAddr,
    EncryptedRaffle: raffleAddr,
    _deployedAt: "2026-05-02-f2-f6",
    _notes:
      (existing._notes || "") +
      " | 2026-05-02-f2-f6: added ConfidentialWrapper + EncryptedRaffle.",
  };
  fs.writeFileSync(addrPath, JSON.stringify(updated, null, 2));

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║              F2 + F6 deploy complete             ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ ConfidentialWrapper: ${wrapperAddr}`);
  console.log(`║ EncryptedRaffle:     ${raffleAddr}`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ ETH spent: ${ethers.formatEther(balance - finalBalance)}`);
  console.log(`║ ETH left:  ${ethers.formatEther(finalBalance)}`);
  console.log("╚══════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
