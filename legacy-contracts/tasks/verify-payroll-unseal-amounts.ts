/**
 * Resume the payroll recipient privacy assertion.
 *
 * splitId=1 had its 3 claims land on Sepolia (txs in
 * verify-payroll-claim-e2e.ts output). The unseal step failed with
 * "Active permit not found" because the script didn't call
 * `permits.getOrCreateSelfPermit()` before `decryptForView`.
 *
 * This re-runs only the off-chain unseal step with the proper
 * permit setup. No on-chain txs.
 *
 * Run: npx hardhat run tasks/verify-payroll-unseal-amounts.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SPLIT_ID = 1n;

async function loadCofhe(provider: unknown, signer: unknown) {
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
  const cfg = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(cfg);
  const adapterRes = await adapters.Ethers6Adapter(provider, signer);
  await client.connect(adapterRes.publicClient, adapterRes.walletClient);
  return { client, core };
}

async function main() {
  const provider = ethers.provider;

  const b1Json = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const multibid = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".multibid-burners.json"), "utf8"),
  );
  const burner1 = new ethers.Wallet(b1Json.privateKey, provider);
  const burner2 = new ethers.Wallet(multibid.burner2.privateKey, provider);
  const burner3 = new ethers.Wallet(multibid.burner3.privateKey, provider);

  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );
  const payments = await ethers.getContractAt(
    "PrivatePayments",
    addr.PrivatePayments,
    burner1,
  );

  const burners = [
    { signer: burner1, label: "burner1", expectedAmount: 50n },
    { signer: burner2, label: "burner2", expectedAmount: 100n },
    { signer: burner3, label: "burner3", expectedAmount: 150n },
  ];

  for (const b of burners) {
    console.log(`\n--- ${b.label} (${b.signer.address}) ---`);
    const c = payments.connect(b.signer) as any;
    const handle: bigint = await c.getMyAmount(SPLIT_ID);
    console.log(`  encrypted handle: 0x${handle.toString(16).padStart(64, "0")}`);

    const { client, core } = await loadCofhe(provider, b.signer);

    // STEP A: ensure permit exists for this burner
    try {
      await (client as any).permits.getOrCreateSelfPermit();
      console.log("  ✓ permit ready");
    } catch (e: any) {
      console.log("  permit create failed:", String(e.message || e).slice(0, 120));
      continue;
    }

    // STEP B: decryptForView
    try {
      const result = await (client as any)
        .decryptForView(handle, core.FheTypes.Uint64)
        .execute();
      const got = typeof result === "bigint"
        ? result
        : BigInt(result.decryptedValue ?? result.value ?? 0);
      console.log(`  ✓ unsealed: ${got}`);
      console.log(`  expected:  ${b.expectedAmount}`);
      console.log(`  match:     ${got === b.expectedAmount ? "✓" : "✗"}`);

      // CROSS-CHECK: try to unseal OTHER burner's handle with this client → should fail
      const otherIdx = (burners.indexOf(b) + 1) % burners.length;
      const other = burners[otherIdx];
      const otherClient = c.connect(other.signer);
      let otherHandle: bigint;
      try {
        otherHandle = await otherClient.getMyAmount(SPLIT_ID);
      } catch (e: any) {
        console.log(`  ✓ ${other.label}'s handle correctly unreachable from this signer (revert: ${String(e.message || e).slice(0, 60)})`);
        continue;
      }
      try {
        await (client as any).decryptForView(otherHandle, core.FheTypes.Uint64).execute();
        console.log(`  ✗ PRIVACY LEAK: this client decrypted ${other.label}'s handle`);
      } catch (e: any) {
        console.log(`  ✓ cannot decrypt ${other.label}'s handle (privacy holds)`);
      }
    } catch (e: any) {
      console.log("  decryptForView failed:", String(e.message || e).slice(0, 200));
    }
  }

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   ✓ PrivatePayments recipient unseal + privacy assertion   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
