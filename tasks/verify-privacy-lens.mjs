// Capture each PrivacyLens mode (me/counterparty/observer) on /treasury
// so the visual story actually demonstrates the three perspectives.
//
// Each mode is preset via localStorage before the page loads.

import { chromium } from "playwright";
import { Wallet, JsonRpcProvider } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const BASE = "https://cipher-dex.vercel.app";
const SEPOLIA_CHAIN_ID = 11155111;

function loadBurner() {
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const rpc = env.match(/SEPOLIA_RPC_URL\s*=\s*"?([^"\n\r]+)"?/)?.[1];
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, ".burner-wallet.json"), "utf8"));
  return { wallet: new Wallet(j.privateKey, new JsonRpcProvider(rpc)), provider: new JsonRpcProvider(rpc) };
}

async function setup(browser, mode) {
  const { wallet, provider } = loadBurner();
  const addr = await wallet.getAddress();
  const chainIdHex = "0x" + SEPOLIA_CHAIN_ID.toString(16);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [
        { name: "zerith-onboarding-seen-v2", value: "1" },
        { name: "zerith-onboarding-seen", value: "1" },
        { name: "zerith-privacy-lens-mode", value: mode },
      ] }],
    },
  });
  await context.exposeFunction("__burnerAddress", () => addr);
  await context.exposeFunction("__burnerChainIdHex", () => chainIdHex);
  await context.exposeFunction("__burnerPersonalSign", async (m) => wallet.signMessage(typeof m === "string" && m.startsWith("0x") ? Buffer.from(m.slice(2), "hex") : m));
  await context.exposeFunction("__burnerSignTypedData", async (d, t, v) => { const ct = { ...t }; delete ct.EIP712Domain; return wallet.signTypedData(d, ct, v); });
  await context.exposeFunction("__burnerSendTransaction", async (tx) => (await wallet.sendTransaction({ to: tx.to, from: tx.from, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gasLimit: tx.gas ? BigInt(tx.gas) : undefined })).hash);
  await context.exposeFunction("__burnerCall", async (tx) => provider.call({ to: tx.to, from: tx.from, data: tx.data }));
  await context.exposeFunction("__burnerRpc", async (m, p) => provider.send(m, p));
  await context.addInitScript(({ chainIdHex }) => {
    const listeners = {};
    const w = window;
    async function request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [await w.__burnerAddress()];
        case "eth_chainId": return chainIdHex;
        case "net_version": return String(parseInt(chainIdHex, 16));
        case "personal_sign": return await w.__burnerPersonalSign(params[0]);
        case "eth_signTypedData_v4": case "eth_signTypedData": { const r = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]; return await w.__burnerSignTypedData(r.domain, r.types, r.message); }
        case "eth_sendTransaction": return await w.__burnerSendTransaction(params[0]);
        case "eth_call": return await w.__burnerCall(params[0]);
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_revokePermissions": return null;
        default: return await w.__burnerRpc(method, params);
      }
    }
    w.ethereum = { isMetaMask: true, request, on(e, c){(listeners[e]=listeners[e]||[]).push(c)}, removeListener(){}, enable: () => request({method:"eth_requestAccounts",params:[]}), _isBurnerShim: true };
    setTimeout(() => { (listeners.connect||[]).forEach(c => c({ chainId: chainIdHex })); }, 100);
  }, { chainIdHex });
  return context;
}

async function main() {
  const outDir = path.join(ROOT, "verification-evidence", "privacy-lens");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  for (const mode of ["me", "counterparty", "observer"]) {
    console.log(`capturing /treasury in ${mode} mode…`);
    const context = await setup(browser, mode);
    const page = await context.newPage();
    await page.goto(`${BASE}/treasury?_cb=${Date.now()}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(outDir, `treasury-${mode}.png`), fullPage: true });
    await context.close();
  }

  await browser.close();
  console.log("Output:", outDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
