import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
async function main() {
  const addr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"));
  const por = await ethers.getContractAt("ProofOfReserves", addr.ProofOfReserves);
  const count = await por.getClaimCount();
  console.log("count:", count.toString());
  for (let i = 0; i < Number(count); i++) {
    const c: any = await por.getClaim(i);
    console.log(`claim #${i}:`, {
      prover: c[0],
      token: c[1].slice(0, 10) + "…",
      threshold: c[2].toString(),
      requestedAt: c[3].toString(),
      revealedAt: c[4].toString(),
      status: c[5].toString(), // 0=PENDING, 1=VERIFIED_TRUE, 2=VERIFIED_FALSE
    });
  }
}
main().then(() => process.exit(0));
