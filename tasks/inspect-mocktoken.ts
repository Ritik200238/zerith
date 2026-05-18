/**
 * Inspect what MockToken at 0x949c…A672 actually is — symbol, name,
 * totalSupply, and whether there's a public mint/faucet so we can
 * top up the burner.
 *
 * Run: npx hardhat run tasks/inspect-mocktoken.ts --network ethSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const provider = ethers.provider;
  const burnerJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".burner-wallet.json"), "utf8"),
  );
  const burnerAddr = burnerJson.address;
  const MOCK = "0x949caC2113c0AF90b309Ec1A9136f7B159d1A672";

  const erc20Abi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function faucet()",
    "function mint(address,uint256)",
  ];
  const m = new ethers.Contract(MOCK, erc20Abi, provider);

  console.log("Inspecting", MOCK);
  for (const fn of ["name", "symbol", "decimals", "totalSupply"]) {
    try {
      const v = await (m as any)[fn]();
      console.log(`  ${fn}:`, v.toString());
    } catch (e: any) {
      console.log(`  ${fn}: ERR ${String(e.message || e).slice(0, 80)}`);
    }
  }

  try {
    const bal = await m.balanceOf(burnerAddr);
    console.log("\n  burner balance:", bal.toString());
  } catch (e: any) {
    console.log("\n  balanceOf failed:", String(e.message || e).slice(0, 80));
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
