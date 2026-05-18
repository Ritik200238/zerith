import { ethers } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const abi = ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"];
  const c = new ethers.Contract("0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2", abi, provider);
  console.log("REAL CDEX 0x5604...");
  console.log("  name:", await c.name());
  console.log("  symbol:", await c.symbol());
  console.log("  decimals:", await c.decimals());
}
main().then(() => process.exit(0));
