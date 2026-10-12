import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
async function main() {
  const addr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8"));
  const por = await ethers.getContractAt("ProofOfReserves", addr.ProofOfReserves);
  const count = await por.getClaimCount();
  console.log("PoR claim count:", count.toString());
}
main().then(() => process.exit(0));
