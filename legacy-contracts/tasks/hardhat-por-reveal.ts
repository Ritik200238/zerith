/**
 * Try PoR Reveal from Hardhat with @cofhe/sdk decryptForTx — same path
 * the UI uses, but in isolation to determine if the TN signature is
 * the issue or if the UI handler has a separate bug.
 *
 * Run: npx hardhat run tasks/hardhat-por-reveal.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burner = new ethers.Wallet(burnerJson.privateKey, provider);
  const addr = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"),
  );

  const por = await ethers.getContractAt("ProofOfReserves", addr.ProofOfReserves);
  const CLAIM_ID = BigInt(process.env.CLAIM_ID ?? "1");
  const claim: any = await por.getClaim(CLAIM_ID);
  console.log("Claim", CLAIM_ID.toString(), "status:", claim[5].toString(), "revealedAt:", claim[4].toString());

  // Get encResult handle from public mapping
  const c: any = await por.claims(CLAIM_ID);
  const encResult: bigint = c[6]; // the encResult euint64 handle
  console.log("encResult handle:", "0x" + encResult.toString(16).padStart(64, "0"));

  // Connect cofhe SDK as burner (the prover)
  const sdk = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "node.js")
  );
  const chains = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "chains.js")
  );
  const adapters = await import(
    path.join(__dirname, "..", "frontend", "node_modules", "@cofhe", "sdk", "dist", "adapters.js")
  );
  const cfg = sdk.createCofheConfig({ supportedChains: [chains.chains.sepolia] });
  const client = sdk.createCofheClient(cfg);
  const { publicClient, walletClient } = await adapters.Ethers6Adapter(provider, burner);
  await client.connect(publicClient, walletClient);

  console.log("decryptForTx...");
  const result = await (client as any).decryptForTx(encResult).withoutPermit().execute();
  console.log("  decryptedValue:", result.decryptedValue.toString());
  console.log("  signature bytes:", result.signature.length);

  // Now submit the reveal tx
  console.log("\nrevealProof tx...");
  const tx = await (por.connect(burner) as any).revealProof(
    CLAIM_ID,
    result.decryptedValue,
    result.signature,
  );
  console.log("  tx hash:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  status:", rcpt?.status);

  // Re-read
  const after: any = await por.getClaim(CLAIM_ID);
  console.log("\nclaim", CLAIM_ID.toString(), "status:", after[5].toString(), "revealedAt:", after[4].toString());
}

main().then(() => process.exit(0)).catch((e) => { console.error("err:", String(e).slice(0, 300)); process.exit(1); });
