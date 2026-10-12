import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const addresses = JSON.parse(fs.readFileSync("./deployed-addresses.json", "utf8"));
  const [deployer] = await ethers.getSigners();
  console.log("Setting up permissions with:", deployer.address);

  const vault = await ethers.getContractAt("SettlementVault", addresses.SettlementVault);
  const registry = await ethers.getContractAt("PlatformRegistry", addresses.PlatformRegistry);
  const token = await ethers.getContractAt("ConfidentialToken", addresses.ConfidentialToken);
  const reputation = await ethers.getContractAt("Reputation", addresses.Reputation);
  const claimNFT = await ethers.getContractAt("AuctionClaim", addresses.AuctionClaim);
  const vesting = await ethers.getContractAt("TokenVesting", addresses.TokenVesting);

  // All settlers
  const settlers = [
    "OrderBook", "SealedAuction", "Escrow", "LimitOrderEngine",
    "BatchAuction", "OTCBoard", "PrivatePayments", "FreelanceBidding",
    "VickreyAuction", "DutchAuction", "OverflowSale", "Referrals", "TokenVesting"
  ];

  console.log("\n--- Vault Settlers ---");
  for (const name of settlers) {
    try {
      const addr = addresses[name];
      const isAuth = await vault.authorizedSettlers(addr);
      if (!isAuth) {
        const tx = await vault.addAuthorizedSettler(addr);
        await tx.wait();
        console.log(`✓ ${name}`);
      } else {
        console.log(`• ${name} (already set)`);
      }
    } catch (e: any) {
      console.log(`✗ ${name}: ${e.reason || e.message?.slice(0, 60)}`);
    }
  }

  // Registry
  console.log("\n--- Registry ---");
  const allContracts = [...settlers, "PortfolioTracker"];
  for (const name of allContracts) {
    try {
      const addr = addresses[name];
      const isReg = await registry.registeredContracts(addr);
      if (!isReg) {
        const tx = await registry.registerContract(addr);
        await tx.wait();
        console.log(`✓ ${name}`);
      } else {
        console.log(`• ${name} (already set)`);
      }
    } catch (e: any) {
      console.log(`✗ ${name}: ${e.reason || e.message?.slice(0, 60)}`);
    }
  }

  // MINTER_ROLE on AuctionClaim
  console.log("\n--- Claim NFT Minters ---");
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const minters = ["SealedAuction", "BatchAuction", "FreelanceBidding", "VickreyAuction", "DutchAuction"];
  for (const name of minters) {
    try {
      const addr = addresses[name];
      const has = await claimNFT.hasRole(MINTER_ROLE, addr);
      if (!has) {
        const tx = await claimNFT.grantRole(MINTER_ROLE, addr);
        await tx.wait();
        console.log(`✓ ${name}`);
      } else {
        console.log(`• ${name} (already set)`);
      }
    } catch (e: any) {
      console.log(`✗ ${name}: ${e.reason || e.message?.slice(0, 60)}`);
    }
  }

  // Reputation callers
  console.log("\n--- Reputation Callers ---");
  const repCallers = ["OrderBook", "SealedAuction", "Escrow", "OTCBoard", "VickreyAuction", "DutchAuction", "FreelanceBidding"];
  for (const name of repCallers) {
    try {
      const addr = addresses[name];
      const tx = await reputation.addAuthorizedCaller(addr);
      await tx.wait();
      console.log(`✓ ${name}`);
    } catch (e: any) {
      console.log(`• ${name} (already set or error)`);
    }
  }

  // Token operator
  console.log("\n--- Token Operator ---");
  try {
    const tx = await token.setOperator(addresses.SettlementVault, (2n ** 48n) - 1n);
    await tx.wait();
    console.log("✓ Vault set as token operator");
  } catch {
    console.log("• Vault already operator");
  }

  // Vesting creators
  console.log("\n--- Vesting Creators ---");
  const vestCreators = ["SealedAuction", "BatchAuction", "VickreyAuction", "DutchAuction", "OverflowSale"];
  for (const name of vestCreators) {
    try {
      const addr = addresses[name];
      const tx = await vesting.authorizeCreator(addr);
      await tx.wait();
      console.log(`✓ ${name}`);
    } catch (e: any) {
      console.log(`• ${name} (already set or error)`);
    }
  }

  console.log("\n✅ All permissions configured!");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
