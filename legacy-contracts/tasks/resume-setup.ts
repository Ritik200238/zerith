/**
 * Resume the deploy-all.ts setup phase against contracts already deployed.
 * Use this after deploy-all.ts hung mid-Step 5 — the contracts are on-chain
 * but the vault settler / registry / minter-role / vesting / reputation
 * authorization txs were not all submitted.
 *
 * Reads addresses from the hard-coded map below (captured from the deploy
 * log). Each tx is `staticCall`-checked before sending so re-runs are
 * idempotent and skip already-completed setup steps.
 *
 * Run: npx hardhat run tasks/resume-setup.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ADDRESSES = {
  ConfidentialToken:    "0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2",
  PlatformRegistry:     "0x0a97e158D0679A29321AB97A54AF666269C5F5A8",
  SettlementVault:      "0x31B751027Ed82b489f42212371d17e30c4D655a5",
  OrderBook:            "0x80b09409f2dB5FAEb45f2ca36C8C1b06772D45E2",
  AuctionClaim:         "0xD46b298b4c4ce04E65b37a7F594D8C8e7876f65c",
  SealedAuction:        "0xdEe59FD1d8Ac071146c7ED012a0a343FdD56b0A0",
  Escrow:               "0x36dbcCAF465f106ebB3da7E9776b0598d4f36d32",
  LimitOrderEngine:     "0x09A01EFA1e97c9f12F1Aa6Dc0dAf1b019a58F8E6",
  BatchAuction:         "0xB29AF471E9392D0bAafc898795d7Ed6Bd6fBEfd5",
  PortfolioTracker:     "0xe72F751B9FB60C542e352F82826f465FD3bc47a0",
  Reputation:           "0xcbD4c5269219f3eE8a1C3Dbe0FB24d1F6558Ac09",
  OTCBoard:             "0x808C27D12265234bE405Eb45800f2BDB1f4Cdb3D",
  PrivatePayments:      "0x15309001612f1667C2Fc1De2107769F438712b4B",
  FreelanceBidding:     "0xf71715fD9c9d314D56FBa0031EBc69ba22d5CE05",
  VickreyAuction:       "0x12973Ac885A11136A9f948beCc6e810CF9D54e17",
  DutchAuction:         "0xd9bA4b7b825f3558757Fe977d024b29e27B65b54",
  OverflowSale:         "0x91b869Ba4Ad80683be67e7F2f776fFf655034Adb",
  TokenVesting:         "0x1be9DF85c8cd48b98f7F0Cc75F565225f00E4895",
  AllowlistGate:        "0xa9d8DA5D2878E8261A1f9c2c53dCA21e849c0EE4",
  Referrals:            "0x77ef973642CC1BAE0756D20E25c83d5b5148af13",
  Organization:         "0x088356c0ab2035605422f8B4Da2d4037487EC1DF",
  EncryptedStreaming:   "0xa3076EF9395E2D7F81d9FB79Cd3E984449F938De",
  ConfidentialMultisig: "0x7250146635a9E0b60471037D6C7c51b21be28d36",
  EncryptedRoyalty:     "0xD3AD70382cEcFdF291c060eE1fA17aE4Eb2DbF32",
  ProofOfReserves:      "0xFA609253c0CA0297e8c272543EE806CAC203bd70",
} as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Resume setup with:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal < ethers.parseEther("0.003")) {
    throw new Error("Deployer < 0.003 ETH — top up before resuming.");
  }

  const vault = await ethers.getContractAt("SettlementVault", ADDRESSES.SettlementVault);
  const registry = await ethers.getContractAt("PlatformRegistry", ADDRESSES.PlatformRegistry);
  const claim = await ethers.getContractAt("AuctionClaim", ADDRESSES.AuctionClaim);
  const vesting = await ethers.getContractAt("TokenVesting", ADDRESSES.TokenVesting);
  const token = await ethers.getContractAt("ConfidentialToken", ADDRESSES.ConfidentialToken);
  const reputation = await ethers.getContractAt("Reputation", ADDRESSES.Reputation);

  // Vault settlers
  const settlers: { name: keyof typeof ADDRESSES }[] = [
    { name: "OrderBook" },
    { name: "SealedAuction" },
    { name: "Escrow" },
    { name: "LimitOrderEngine" },
    { name: "BatchAuction" },
    { name: "OTCBoard" },
    { name: "PrivatePayments" },
    { name: "FreelanceBidding" },
    { name: "VickreyAuction" },
    { name: "DutchAuction" },
    { name: "OverflowSale" },
    { name: "Referrals" },
    { name: "EncryptedStreaming" },
    { name: "ConfidentialMultisig" },
    { name: "EncryptedRoyalty" },
    { name: "TokenVesting" },
  ];
  console.log("\n--- Step 5: Vault settlers ---");
  for (const { name } of settlers) {
    const addr = ADDRESSES[name];
    const already = await vault.authorizedSettlers(addr).catch(() => false);
    if (already) { console.log("  skip", name, "(already authorized)"); continue; }
    const tx = await vault.addAuthorizedSettler(addr);
    await tx.wait();
    console.log("  ✓ authorized", name);
  }

  // Auction claim MINTER_ROLE
  console.log("\n--- Step 5b: AuctionClaim MINTER_ROLE ---");
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  for (const name of ["SealedAuction", "BatchAuction", "FreelanceBidding", "VickreyAuction", "DutchAuction"] as const) {
    const addr = ADDRESSES[name];
    const has = await claim.hasRole(MINTER_ROLE, addr).catch(() => false);
    if (has) { console.log("  skip", name, "(already minter)"); continue; }
    const tx = await claim.grantRole(MINTER_ROLE, addr);
    await tx.wait();
    console.log("  ✓ minter granted to", name);
  }

  // Vesting authorize creators
  console.log("\n--- Step 5c: TokenVesting creators ---");
  for (const name of ["SealedAuction", "BatchAuction", "VickreyAuction", "DutchAuction", "OverflowSale"] as const) {
    const addr = ADDRESSES[name];
    const auth = await vesting.authorizedCreators(addr).catch(() => false);
    if (auth) { console.log("  skip", name); continue; }
    const tx = await vesting.authorizeCreator(addr);
    await tx.wait();
    console.log("  ✓ vesting creator", name);
  }

  // Registry registrations
  console.log("\n--- Step 6: Registry registrations ---");
  const regList: { name: keyof typeof ADDRESSES }[] = [
    { name: "OrderBook" }, { name: "SealedAuction" }, { name: "Escrow" },
    { name: "LimitOrderEngine" }, { name: "BatchAuction" }, { name: "PortfolioTracker" },
    { name: "Reputation" }, { name: "OTCBoard" }, { name: "PrivatePayments" },
    { name: "FreelanceBidding" }, { name: "VickreyAuction" }, { name: "DutchAuction" },
    { name: "OverflowSale" }, { name: "TokenVesting" }, { name: "Referrals" },
    { name: "Organization" }, { name: "EncryptedStreaming" }, { name: "ConfidentialMultisig" },
    { name: "EncryptedRoyalty" }, { name: "ProofOfReserves" },
  ];
  for (const { name } of regList) {
    const addr = ADDRESSES[name];
    const has = await registry.isRegisteredContract(addr).catch(() => false);
    if (has) { console.log("  skip", name); continue; }
    const tx = await registry.registerContract(addr);
    await tx.wait();
    console.log("  ✓ registered", name);
  }

  // Vault supportedTokens + token operator
  console.log("\n--- Step 7: Vault supportedTokens + token operator ---");
  const supported = await vault.supportedTokens(ADDRESSES.ConfidentialToken).catch(() => false);
  if (!supported) {
    const tx = await vault.addSupportedToken(ADDRESSES.ConfidentialToken);
    await tx.wait();
    console.log("  ✓ added CDEX as supported");
  } else {
    console.log("  skip supported (already)");
  }
  const isOp = await token.isOperator(deployer.address, ADDRESSES.SettlementVault).catch(() => false);
  if (!isOp) {
    const tx = await token.setOperator(ADDRESSES.SettlementVault, (2n ** 48n) - 1n);
    await tx.wait();
    console.log("  ✓ deployer set vault as operator");
  } else {
    console.log("  skip operator (already)");
  }

  // Reputation callers
  console.log("\n--- Step 8: Reputation callers ---");
  for (const name of ["OrderBook", "SealedAuction", "Escrow", "OTCBoard", "VickreyAuction", "DutchAuction", "FreelanceBidding"] as const) {
    const addr = ADDRESSES[name];
    const has = await reputation.authorizedCallers(addr).catch(() => false);
    if (has) { console.log("  skip", name); continue; }
    const tx = await reputation.addAuthorizedCaller(addr);
    await tx.wait();
    console.log("  ✓ caller", name);
  }

  // Write deployed-addresses.json
  console.log("\n--- Writing deployed-addresses.json ---");
  const out = {
    _network: "ethSepolia",
    _chainId: 11155111,
    _deployedAt: new Date().toISOString().split("T")[0] + "-vault-acl-fix",
    _notes: "Redeployed all contracts with SettlementVault.deposit/withdraw FHE.allowTransient(amount, token) fix",
    ...ADDRESSES,
    MockToken: "0x949caC2113c0AF90b309Ec1A9136f7B159d1A672", // unchanged
    _lastSeededAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployed-addresses.json"), JSON.stringify(out, null, 2));
  console.log("  ✓ wrote deployed-addresses.json");

  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║          Setup Complete               ║");
  console.log("╚═══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
