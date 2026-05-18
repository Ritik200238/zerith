/**
 * End-to-end Treasury deposit verification.
 *
 * Uses the burner key from .burner-wallet.json to:
 *  1) Faucet 1000 CDEX from the new ConfidentialToken
 *  2) setOperator(vault, max) on the token
 *  3) Encrypt amount=10 via @cofhe/sdk's node client
 *  4) Call vault.deposit(token, encAmount)
 *  5) Read vault.getMyEncryptedBalance(token) to confirm a non-zero handle
 *
 * If this succeeds, the FHE.allowTransient fix is live end-to-end.
 *
 * Run: npx hardhat run tasks/verify-deposit-e2e.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // Load burner
  const burnerPath = path.join(__dirname, "..", ".burner-wallet.json");
  const burnerJson = JSON.parse(fs.readFileSync(burnerPath, "utf8"));
  console.log("Burner:", burnerJson.address);

  const provider = ethers.provider;
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);
  const bal = await provider.getBalance(burner.address);
  console.log("Burner ETH:", ethers.formatEther(bal));
  if (bal < ethers.parseEther("0.001")) throw new Error("Burner ETH too low.");

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  console.log("Token:", addresses.ConfidentialToken);
  console.log("Vault:", addresses.SettlementVault);

  const token = await ethers.getContractAt(
    "ConfidentialToken",
    addresses.ConfidentialToken,
    burner,
  );
  const vault = await ethers.getContractAt(
    "SettlementVault",
    addresses.SettlementVault,
    burner,
  );

  // Step 1: faucet (idempotent — contract enforces once-per-address)
  console.log("\n--- Step 1: Faucet 1000 CDEX from burner ---");
  try {
    const faucetTx = await token.faucet();
    console.log("  tx:", faucetTx.hash);
    await faucetTx.wait();
    console.log("  ✓ faucet confirmed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reverted/i.test(msg)) {
      console.log("  skip — already claimed (contract reverts on re-claim)");
    } else {
      throw err;
    }
  }

  // Step 2: setOperator
  console.log("\n--- Step 2: setOperator(vault) ---");
  const isOp = await token.isOperator(burner.address, addresses.SettlementVault);
  if (isOp) {
    console.log("  skip — already operator");
  } else {
    const opTx = await token.setOperator(addresses.SettlementVault, (2n ** 48n) - 1n);
    console.log("  tx:", opTx.hash);
    await opTx.wait();
    console.log("  ✓ operator set");
  }

  // Step 3: encrypt 10 via @cofhe/sdk node client
  console.log("\n--- Step 3: Encrypt 10 CDEX via @cofhe/sdk ---");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sdk = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "node.js")
  );
  const core = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "core.js")
  );
  const chains = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "chains.js")
  );
  const adapters = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "adapters.js")
  );

  const config = sdk.createCofheConfig({
    supportedChains: [chains.chains.sepolia],
  });
  const client = sdk.createCofheClient(config);
  const adapterRes = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  console.log("  ✓ cofhe client connected");

  // Encryptable lives in the core entry
  const Encryptable = core.Encryptable;
  if (!Encryptable?.uint64) throw new Error("Encryptable.uint64 not found in core entry");
  const items = [Encryptable.uint64(10n)];
  console.log("  encrypting 10 CDEX as euint64...");
  const result = await client.encryptInputs(items).execute();
  console.log("  ✓ encrypted, handle len:", result.length, "first hash:",
    result[0]?.ctHash ?? result[0]);

  // Step 4: deposit
  console.log("\n--- Step 4: vault.deposit(token, encAmount) ---");
  const depositTx = await vault.deposit(addresses.ConfidentialToken, result[0]);
  console.log("  tx:", depositTx.hash);
  const rcpt = await depositTx.wait();
  console.log("  ✓ deposit mined, status:", rcpt?.status);

  // Step 5: read vault encrypted balance handle
  console.log("\n--- Step 5: Verify vault.encBalances ---");
  const handle = await vault.getEncBalance(burner.address, addresses.ConfidentialToken);
  console.log("  encBalances handle:", handle.toString());
  if (handle === 0n) throw new Error("Balance handle is zero — deposit didn't credit.");
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   ✓ Treasury Deposit E2E WORKS       ║");
  console.log("╚══════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
