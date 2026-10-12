/**
 * Deploy the core product: SettlementVault (escrow, honest deposits),
 * SealedAuction (escrowed bids), PrivatePayments (escrowed payroll) and
 * ProofOfReserves (one-step proofs), built against CoFHE 1.0.
 *
 * By default it reuses the tokens, registry and claim NFT already recorded in
 * deployed-addresses.json. With FRESH=1 (or when those are missing) it deploys
 * them too, so anyone can stand up their own copy:
 *
 *   npx hardhat run tasks/deploy-core.ts --network ethSepolia
 *   FRESH=1 npx hardhat run tasks/deploy-core.ts --network ethSepolia
 */

import hre, { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ADDR_FILE = path.join(__dirname, "..", "deployed-addresses.json");
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

async function main() {
  // On a local Hardhat network, load Fhenix's mock coprocessor first (tests do this automatically).
  if (hre.network.name === "hardhat") await hre.cofhe.mocks.deployMocks();

  const [deployer] = await ethers.getSigners();
  const addrs = fs.existsSync(ADDR_FILE) ? JSON.parse(fs.readFileSync(ADDR_FILE, "utf8")) : {};
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Hardhat's fee guess assumes a 1 gwei tip; Sepolia currently clears at ~0.001 gwei.
  // Use live network fees with headroom so the deployer isn't priced out.
  const tip = BigInt(await ethers.provider.send("eth_maxPriorityFeePerGas", []));
  const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n;
  const fees = { maxPriorityFeePerGas: tip * 2n, maxFeePerGas: base * 3n + tip * 2n };
  console.log("Fees    :", ethers.formatUnits(fees.maxFeePerGas, "gwei"), "gwei max");

  async function deploy(name: string, args: unknown[]) {
    const F = await ethers.getContractFactory(name);
    const c = await F.deploy(...args, fees);
    await c.waitForDeployment();
    const a = await c.getAddress();
    console.log(`${name.padEnd(18)} ${a}`);
    return { c, a };
  }

  const fresh =
    process.env.FRESH === "1" ||
    !addrs.ConfidentialToken || !addrs.MockToken || !addrs.PlatformRegistry || !addrs.AuctionClaim;
  let token = addrs.ConfidentialToken as string;
  let mock = addrs.MockToken as string;
  let registry = addrs.PlatformRegistry as string;
  let claim = addrs.AuctionClaim as string;
  if (fresh) {
    console.log("FRESH deploy: tokens, registry and claim NFT too");
    token = (await deploy("ConfidentialToken", ["Zerith Test Dollar", "CDEX"])).a;
    mock = (await deploy("ConfidentialToken", ["Mock Project Token", "MOCK"])).a; // the lot side
    registry = (await deploy("PlatformRegistry", [deployer.address, 50, deployer.address])).a;
    claim = (await deploy("AuctionClaim", [deployer.address])).a;
  }

  const { c: vault, a: vaultAddr } = await deploy("SettlementVault", [token, registry, deployer.address]);
  await (await vault.getFunction("addSupportedToken")(mock, fees)).wait();

  const auction = await deploy("SealedAuction", [vaultAddr, registry, claim]);
  const payments = await deploy("PrivatePayments", [vaultAddr, registry]);
  const por = await deploy("ProofOfReserves", [vaultAddr, registry]);

  for (const s of [auction, payments, por]) {
    await (await vault.getFunction("addAuthorizedSettler")(s.a, fees)).wait();
  }
  console.log("Authorized 3 settlers on the new vault");

  const claimNFT = await ethers.getContractAt("AuctionClaim", claim);
  for (const s of [auction]) {
    await (await claimNFT.grantRole(MINTER_ROLE, s.a, fees)).wait();
  }
  console.log("Granted AuctionClaim MINTER_ROLE to SealedAuction");

  const reg = await ethers.getContractAt("PlatformRegistry", registry);
  for (const s of [auction, payments, por]) {
    try {
      await (await reg.registerContract(s.a, fees)).wait();
    } catch (e) {
      console.warn("registerContract failed (non-fatal):", s.a, (e as Error).message.slice(0, 80));
    }
  }

  const updated = {
    ...addrs,
    _network: (await ethers.provider.getNetwork()).name,
    _chainId: Number((await ethers.provider.getNetwork()).chainId),
    ConfidentialToken: token,
    MockToken: mock,
    PlatformRegistry: registry,
    AuctionClaim: claim,
    _deployedAt: new Date().toISOString().slice(0, 10) + "-core-cofhe-1.0",
    _notes: "Core on CoFHE 1.0: escrowed vault, sealed auction, payroll, proof of reserves. Paused features keep their old addresses.",
    SettlementVault: vaultAddr,
    SealedAuction: auction.a,
    PrivatePayments: payments.a,
    ProofOfReserves: por.a,
  };
  fs.writeFileSync(ADDR_FILE, JSON.stringify(updated, null, 2) + "\n");
  console.log("Wrote", ADDR_FILE);
  console.log("Balance after:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
