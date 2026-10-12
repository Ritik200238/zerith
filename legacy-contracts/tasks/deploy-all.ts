import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CipherDEX with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ─── Step 1: Deploy ConfidentialToken (FHERC20) ───────────
  console.log("\n--- Step 1: ConfidentialToken ---");
  const Token = await ethers.getContractFactory("ConfidentialToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("ConfidentialToken deployed to:", tokenAddr);

  // ─── Step 2: Deploy PlatformRegistry ──────────────────────
  console.log("\n--- Step 2: PlatformRegistry ---");
  const Registry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await Registry.deploy(
    deployer.address,  // admin
    50,                // 0.5% fee (50 basis points)
    deployer.address   // fee collector (deployer for testnet)
  );
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("PlatformRegistry deployed to:", registryAddr);

  // ─── Step 3: Deploy SettlementVault ───────────────────────
  console.log("\n--- Step 3: SettlementVault ---");
  const Vault = await ethers.getContractFactory("SettlementVault");
  const vault = await Vault.deploy(tokenAddr, registryAddr, deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("SettlementVault deployed to:", vaultAddr);

  // ─── Step 4: Deploy Feature Contracts ─────────────────────
  console.log("\n--- Step 4: Feature Contracts ---");

  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = await OrderBook.deploy(vaultAddr, registryAddr);
  await orderBook.waitForDeployment();
  const orderBookAddr = await orderBook.getAddress();
  console.log("OrderBook deployed to:", orderBookAddr);

  // Deploy AuctionClaim FIRST (needed by SealedAuction + FreelanceBidding)
  const AuctionClaim = await ethers.getContractFactory("AuctionClaim");
  const claimNFT = await AuctionClaim.deploy(deployer.address);
  await claimNFT.waitForDeployment();
  const claimAddr = await claimNFT.getAddress();
  console.log("AuctionClaim deployed to:", claimAddr);

  const SealedAuction = await ethers.getContractFactory("SealedAuction");
  const auction = await SealedAuction.deploy(vaultAddr, registryAddr, claimAddr);
  await auction.waitForDeployment();
  const auctionAddr = await auction.getAddress();
  console.log("SealedAuction deployed to:", auctionAddr);

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(vaultAddr, registryAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("Escrow deployed to:", escrowAddr);

  const LimitOrderEngine = await ethers.getContractFactory("LimitOrderEngine");
  const limitEngine = await LimitOrderEngine.deploy(vaultAddr, registryAddr, deployer.address);
  await limitEngine.waitForDeployment();
  const limitAddr = await limitEngine.getAddress();
  console.log("LimitOrderEngine deployed to:", limitAddr);

  const BatchAuction = await ethers.getContractFactory("BatchAuction");
  const batchAuction = await BatchAuction.deploy(vaultAddr, registryAddr, deployer.address);
  await batchAuction.waitForDeployment();
  const batchAddr = await batchAuction.getAddress();
  console.log("BatchAuction deployed to:", batchAddr);

  const PortfolioTracker = await ethers.getContractFactory("PortfolioTracker");
  const portfolio = await PortfolioTracker.deploy(vaultAddr);
  await portfolio.waitForDeployment();
  const portfolioAddr = await portfolio.getAddress();
  console.log("PortfolioTracker deployed to:", portfolioAddr);

  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(registryAddr, deployer.address);
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  console.log("Reputation deployed to:", reputationAddr);

  const OTCBoard = await ethers.getContractFactory("OTCBoard");
  const otcBoard = await OTCBoard.deploy(vaultAddr, registryAddr);
  await otcBoard.waitForDeployment();
  const otcAddr = await otcBoard.getAddress();
  console.log("OTCBoard deployed to:", otcAddr);

  // ─── Step 4b: NEW Feature Contracts ───────────────────────
  console.log("\n--- Step 4b: New Features ---");

  const PrivatePayments = await ethers.getContractFactory("PrivatePayments");
  const payments = await PrivatePayments.deploy(vaultAddr, registryAddr);
  await payments.waitForDeployment();
  const paymentsAddr = await payments.getAddress();
  console.log("PrivatePayments deployed to:", paymentsAddr);

  const FreelanceBidding = await ethers.getContractFactory("FreelanceBidding");
  const freelance = await FreelanceBidding.deploy(vaultAddr, registryAddr, deployer.address, claimAddr);
  await freelance.waitForDeployment();
  const freelanceAddr = await freelance.getAddress();
  console.log("FreelanceBidding deployed to:", freelanceAddr);

  const VickreyAuction = await ethers.getContractFactory("VickreyAuction");
  const vickrey = await VickreyAuction.deploy(vaultAddr, registryAddr, claimAddr);
  await vickrey.waitForDeployment();
  const vickreyAddr = await vickrey.getAddress();
  console.log("VickreyAuction deployed to:", vickreyAddr);

  const DutchAuction = await ethers.getContractFactory("DutchAuction");
  const dutch = await DutchAuction.deploy(vaultAddr, registryAddr, claimAddr);
  await dutch.waitForDeployment();
  const dutchAddr = await dutch.getAddress();
  console.log("DutchAuction deployed to:", dutchAddr);

  const OverflowSale = await ethers.getContractFactory("OverflowSale");
  const overflow = await OverflowSale.deploy(vaultAddr, registryAddr);
  await overflow.waitForDeployment();
  const overflowAddr = await overflow.getAddress();
  console.log("OverflowSale deployed to:", overflowAddr);

  // ─── Step 4c: Core Support Contracts ──────────────────────
  console.log("\n--- Step 4c: Core Support ---");

  const TokenVesting = await ethers.getContractFactory("TokenVesting");
  const vesting = await TokenVesting.deploy(vaultAddr, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log("TokenVesting deployed to:", vestingAddr);

  const AllowlistGate = await ethers.getContractFactory("AllowlistGate");
  const allowlist = await AllowlistGate.deploy();
  await allowlist.waitForDeployment();
  const allowlistAddr = await allowlist.getAddress();
  console.log("AllowlistGate deployed to:", allowlistAddr);

  const Referrals = await ethers.getContractFactory("Referrals");
  const referrals = await Referrals.deploy(vaultAddr);
  await referrals.waitForDeployment();
  const referralsAddr = await referrals.getAddress();
  console.log("Referrals deployed to:", referralsAddr);

  // ─── Wave 4 — Organization + EncryptedStreaming ────────────
  const Organization = await ethers.getContractFactory("Organization");
  const organization = await Organization.deploy(registryAddr);
  await organization.waitForDeployment();
  const organizationAddr = await organization.getAddress();
  console.log("Organization deployed to:", organizationAddr);

  const EncryptedStreaming = await ethers.getContractFactory("EncryptedStreaming");
  const streaming = await EncryptedStreaming.deploy(vaultAddr);
  await streaming.waitForDeployment();
  const streamingAddr = await streaming.getAddress();
  console.log("EncryptedStreaming deployed to:", streamingAddr);

  // ─── Wave 5+ — ConfidentialMultisig + EncryptedRoyalty ─────
  const ConfidentialMultisig = await ethers.getContractFactory("ConfidentialMultisig");
  const multisig = await ConfidentialMultisig.deploy(vaultAddr);
  await multisig.waitForDeployment();
  const multisigAddr = await multisig.getAddress();
  console.log("ConfidentialMultisig deployed to:", multisigAddr);

  const EncryptedRoyalty = await ethers.getContractFactory("EncryptedRoyalty");
  const royalty = await EncryptedRoyalty.deploy(vaultAddr);
  await royalty.waitForDeployment();
  const royaltyAddr = await royalty.getAddress();
  console.log("EncryptedRoyalty deployed to:", royaltyAddr);

  // ─── ProofOfReserves — encrypted reserve threshold proofs ─
  const ProofOfReserves = await ethers.getContractFactory("ProofOfReserves");
  const proofOfReserves = await ProofOfReserves.deploy(vaultAddr, registryAddr);
  await proofOfReserves.waitForDeployment();
  const proofAddr = await proofOfReserves.getAddress();
  console.log("ProofOfReserves deployed to:", proofAddr);

  // ─── Step 5: Set Vault Permissions ────────────────────────
  console.log("\n--- Step 5: Vault Permissions ---");

  // Authorize feature contracts as settlers
  await vault.addAuthorizedSettler(orderBookAddr);
  console.log("Authorized OrderBook as settler");

  await vault.addAuthorizedSettler(auctionAddr);
  console.log("Authorized SealedAuction as settler");

  await vault.addAuthorizedSettler(escrowAddr);
  console.log("Authorized Escrow as settler");

  await vault.addAuthorizedSettler(limitAddr);
  console.log("Authorized LimitOrderEngine as settler");

  await vault.addAuthorizedSettler(batchAddr);
  console.log("Authorized BatchAuction as settler");

  await vault.addAuthorizedSettler(otcAddr);
  console.log("Authorized OTCBoard as settler");

  await vault.addAuthorizedSettler(paymentsAddr);
  console.log("Authorized PrivatePayments as settler");

  await vault.addAuthorizedSettler(freelanceAddr);
  console.log("Authorized FreelanceBidding as settler");

  await vault.addAuthorizedSettler(vickreyAddr);
  console.log("Authorized VickreyAuction as settler");

  await vault.addAuthorizedSettler(dutchAddr);
  console.log("Authorized DutchAuction as settler");

  await vault.addAuthorizedSettler(overflowAddr);
  console.log("Authorized OverflowSale as settler");

  await vault.addAuthorizedSettler(referralsAddr);
  console.log("Authorized Referrals as settler");

  await vault.addAuthorizedSettler(streamingAddr);
  console.log("Authorized EncryptedStreaming as settler");

  await vault.addAuthorizedSettler(multisigAddr);
  console.log("Authorized ConfidentialMultisig as settler");

  await vault.addAuthorizedSettler(royaltyAddr);
  console.log("Authorized EncryptedRoyalty as settler");

  // ─── Step 5b: AuctionClaim MINTER_ROLE ────────────────────
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await claimNFT.grantRole(MINTER_ROLE, auctionAddr);
  await claimNFT.grantRole(MINTER_ROLE, batchAddr);
  await claimNFT.grantRole(MINTER_ROLE, freelanceAddr);
  await claimNFT.grantRole(MINTER_ROLE, vickreyAddr);
  await claimNFT.grantRole(MINTER_ROLE, dutchAddr);
  console.log("Granted MINTER_ROLE to all auction contracts");

  // ─── Step 5c: TokenVesting authorization ──────────────────
  await vesting.authorizeCreator(auctionAddr);
  await vesting.authorizeCreator(batchAddr);
  await vesting.authorizeCreator(vickreyAddr);
  await vesting.authorizeCreator(dutchAddr);
  await vesting.authorizeCreator(overflowAddr);
  console.log("Authorized auction contracts to create vesting schedules");

  // ─── Step 5d: Vault authorize vesting for settlements ─────
  await vault.addAuthorizedSettler(vestingAddr);
  console.log("Authorized TokenVesting as settler");

  // ─── Step 6: Register Feature Contracts ───────────────────
  console.log("\n--- Step 6: Registry ---");

  await registry.registerContract(orderBookAddr);
  await registry.registerContract(auctionAddr);
  await registry.registerContract(escrowAddr);
  await registry.registerContract(limitAddr);
  await registry.registerContract(batchAddr);
  await registry.registerContract(portfolioAddr);
  await registry.registerContract(reputationAddr);
  await registry.registerContract(otcAddr);
  await registry.registerContract(paymentsAddr);
  await registry.registerContract(freelanceAddr);
  await registry.registerContract(vickreyAddr);
  await registry.registerContract(dutchAddr);
  await registry.registerContract(overflowAddr);
  await registry.registerContract(vestingAddr);
  await registry.registerContract(referralsAddr);
  await registry.registerContract(organizationAddr);
  await registry.registerContract(streamingAddr);
  await registry.registerContract(multisigAddr);
  await registry.registerContract(royaltyAddr);
  await registry.registerContract(proofAddr);
  console.log("Registered all feature contracts");

  // ─── Step 7: Set Token Operator (Vault) ───────────────────
  console.log("\n--- Step 7: Token Operator ---");

  // Allow vault to transfer tokens on behalf of users
  // max uint48 expiration = no expiry
  await token.setOperator(vaultAddr, (2n ** 48n) - 1n);
  console.log("Set vault as token operator");

  // ─── Step 8: Authorize Reputation Callers ─────────────────
  console.log("\n--- Step 8: Reputation Callers ---");

  await reputation.addAuthorizedCaller(orderBookAddr);
  await reputation.addAuthorizedCaller(auctionAddr);
  await reputation.addAuthorizedCaller(escrowAddr);
  await reputation.addAuthorizedCaller(otcAddr);
  await reputation.addAuthorizedCaller(vickreyAddr);
  await reputation.addAuthorizedCaller(dutchAddr);
  await reputation.addAuthorizedCaller(freelanceAddr);
  console.log("Authorized feature contracts to record trades");

  // ─── Summary ──────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║           CipherDEX Deployment Complete          ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ ConfidentialToken:  ${tokenAddr}`);
  console.log(`║ PlatformRegistry:   ${registryAddr}`);
  console.log(`║ SettlementVault:    ${vaultAddr}`);
  console.log(`║ OrderBook:          ${orderBookAddr}`);
  console.log(`║ SealedAuction:      ${auctionAddr}`);
  console.log(`║ Escrow:             ${escrowAddr}`);
  console.log(`║ LimitOrderEngine:   ${limitAddr}`);
  console.log(`║ BatchAuction:       ${batchAddr}`);
  console.log(`║ PortfolioTracker:   ${portfolioAddr}`);
  console.log(`║ Reputation:         ${reputationAddr}`);
  console.log(`║ OTCBoard:           ${otcAddr}`);
  console.log(`║ PrivatePayments:    ${paymentsAddr}`);
  console.log(`║ FreelanceBidding:   ${freelanceAddr}`);
  console.log(`║ AuctionClaim:       ${claimAddr}`);
  console.log(`║ VickreyAuction:     ${vickreyAddr}`);
  console.log(`║ DutchAuction:       ${dutchAddr}`);
  console.log(`║ OverflowSale:       ${overflowAddr}`);
  console.log(`║ TokenVesting:       ${vestingAddr}`);
  console.log(`║ AllowlistGate:      ${allowlistAddr}`);
  console.log(`║ Referrals:          ${referralsAddr}`);
  console.log(`║ Organization:       ${organizationAddr}`);
  console.log(`║ EncryptedStreaming: ${streamingAddr}`);
  console.log(`║ ConfidentialMultisig: ${multisigAddr}`);
  console.log(`║ EncryptedRoyalty:   ${royaltyAddr}`);
  console.log(`║ ProofOfReserves:    ${proofAddr}`);
  console.log("╚══════════════════════════════════════════════════╝");

  // Write addresses to file for frontend consumption
  const addresses = {
    ConfidentialToken: tokenAddr,
    PlatformRegistry: registryAddr,
    SettlementVault: vaultAddr,
    OrderBook: orderBookAddr,
    SealedAuction: auctionAddr,
    Escrow: escrowAddr,
    LimitOrderEngine: limitAddr,
    BatchAuction: batchAddr,
    PortfolioTracker: portfolioAddr,
    Reputation: reputationAddr,
    OTCBoard: otcAddr,
    PrivatePayments: paymentsAddr,
    FreelanceBidding: freelanceAddr,
    AuctionClaim: claimAddr,
    VickreyAuction: vickreyAddr,
    DutchAuction: dutchAddr,
    OverflowSale: overflowAddr,
    TokenVesting: vestingAddr,
    AllowlistGate: allowlistAddr,
    Referrals: referralsAddr,
    Organization: organizationAddr,
    EncryptedStreaming: streamingAddr,
    ConfidentialMultisig: multisigAddr,
    EncryptedRoyalty: royaltyAddr,
    ProofOfReserves: proofAddr,
  };

  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses written to deployed-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
