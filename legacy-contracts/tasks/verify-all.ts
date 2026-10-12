import { run } from "hardhat";

const DEPLOYER = "0x82c16269FFd99C747D9437974E4d44C49187DCFF";

const CONTRACTS = [
  { name: "ConfidentialToken", address: "0xd5524d656477E803a6BE96b5C044CdBb492C8297", args: [] },
  { name: "PlatformRegistry", address: "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", args: [DEPLOYER, 50, DEPLOYER] },
  { name: "SettlementVault", address: "0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", args: ["0xd5524d656477E803a6BE96b5C044CdBb492C8297", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", DEPLOYER] },
  { name: "AuctionClaim", address: "0x9c95BEE65C81e1508b37e3f2c240dB65A508c51c", args: [DEPLOYER] },
  { name: "OrderBook", address: "0xeAD0E2a126E3121FCacEb50470AaD38B6F3027a2", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f"] },
  { name: "SealedAuction", address: "0x9F15192dA0520EB7256cDc04730D65D627E92f60", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", "0x9c95BEE65C81e1508b37e3f2c240dB65A508c51c"] },
  { name: "Escrow", address: "0x2019c9B7B045F782bD63ff7858d2e1fbA502050C", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f"] },
  { name: "LimitOrderEngine", address: "0x83B4Df4CcE798a2Ec62Fed8445AdC0936bCF9878", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", DEPLOYER] },
  { name: "BatchAuction", address: "0x4503315aD5993647212cd577A3B000053cd90106", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", DEPLOYER] },
  { name: "PortfolioTracker", address: "0x9e3139C53c66dfAcd80a6c9f1E78B45939467ffB", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd"] },
  { name: "Reputation", address: "0x23e5DdcaF6946123769BBe32BA0Fd6eDd7A973EB", args: ["0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", DEPLOYER] },
  { name: "OTCBoard", address: "0xe643654be7792d0Ba957bc8CECbE74C1e2c28c36", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f"] },
  { name: "PrivatePayments", address: "0x04F8b006A299dfE677e108ebd616E2F21c722E34", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f"] },
  { name: "FreelanceBidding", address: "0xef9c5d3457CcE981f9641213B81832272383C0FA", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", DEPLOYER, "0x9c95BEE65C81e1508b37e3f2c240dB65A508c51c"] },
  { name: "VickreyAuction", address: "0x04270b991B3a9aF98EEc50ee1cadA40Eabc3570e", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", "0x9c95BEE65C81e1508b37e3f2c240dB65A508c51c"] },
  { name: "DutchAuction", address: "0x44A04fFd7B3F14F279f3F8cEc530C2A21cb04845", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f", "0x9c95BEE65C81e1508b37e3f2c240dB65A508c51c"] },
  { name: "OverflowSale", address: "0x6f5348fF3C725C2DD34E353F1B35d3AE778baA27", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", "0xC4b6BB51F81eAd8dd65C6Aa26865f4793B2A438f"] },
  { name: "TokenVesting", address: "0x920ee2B93b1C7316811D8aC78F85bbA8bB8518Dc", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd", DEPLOYER] },
  { name: "AllowlistGate", address: "0x0579B82D5d0F35Ca76DDC0E384D96DfE589fC296", args: [] },
  { name: "Referrals", address: "0xc7c63B43365997F02077188c664DE1a33Db3BC3D", args: ["0xa5f512e526aE4E7CBd5e6f4593396d7fcaeE71Cd"] },
];

async function main() {
  console.log("Verifying 20 contracts on Etherscan...\n");

  let passed = 0;
  let failed = 0;

  for (const contract of CONTRACTS) {
    try {
      await run("verify:verify", {
        address: contract.address,
        constructorArguments: contract.args,
      });
      console.log(`✓ ${contract.name}`);
      passed++;
    } catch (e: any) {
      if (e.message?.includes("Already Verified")) {
        console.log(`• ${contract.name} (already verified)`);
        passed++;
      } else {
        console.log(`✗ ${contract.name}: ${e.message?.slice(0, 80)}`);
        failed++;
      }
    }
  }

  console.log(`\n✅ Verified: ${passed}/${CONTRACTS.length} | Failed: ${failed}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
