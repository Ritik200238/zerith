import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
async function main() {
  const provider = ethers.provider;
  const burnerJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"));
  const nonce = await provider.getTransactionCount(burnerJson.address);
  console.log("Burner nonce:", nonce);
}
main().then(() => process.exit(0));
