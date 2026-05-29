import { ethers } from "hardhat";

const FUNDER = "0x2c9556ce62536C80AA283Dbf2d787da903b7326a";
const TOP_UP_ETH = "0.015";

async function main() {
  const [deployer] = await ethers.getSigners();
  const before = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance before:", ethers.formatEther(before), "ETH");

  const tx = await deployer.sendTransaction({
    to: FUNDER,
    value: ethers.parseEther(TOP_UP_ETH),
  });
  console.log("Top-up tx:", tx.hash);
  await tx.wait();

  const dAfter = await ethers.provider.getBalance(deployer.address);
  const fAfter = await ethers.provider.getBalance(FUNDER);
  console.log("Deployer balance after:", ethers.formatEther(dAfter), "ETH");
  console.log("Funder balance after:  ", ethers.formatEther(fAfter), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
