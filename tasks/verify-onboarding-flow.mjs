// Walk the OnboardingModal — every screen with a screenshot.
// This is the first impression for every new visitor — must be pristine.

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

async function setupFresh(browser) {
  const { wallet, provider } = loadBurner();
  const addr = await wallet.getAddress();
  const chainIdHex = "0x" + SEPOLIA_CHAIN_ID.toString(16);
  // NO localStorage seed → onboarding modal will auto-open
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
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
  const outDir = path.join(ROOT, "verification-evidence", "onboarding");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await setupFresh(browser);
  const page = await context.newPage();
  const consoleLog = [];
  page.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));

  await page.goto(`${BASE}/?_cb=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, "00-welcome.png"), fullPage: false });

  // Step through Next 4x (5-step modal), then capture the final path-pick screen
  for (let step = 1; step <= 5; step++) {
    const next = page.getByRole("button", { name: /^Next$|Get test tokens|Continue to Treasury|^Open /i }).first();
    if (!(await next.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log(`step ${step}: no advance button — modal complete`);
      break;
    }
    const text = (await next.textContent().catch(() => "?"))?.trim() || "?";
    console.log(`step ${step}: clicking "${text}"`);
    await next.click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outDir, `${String(step).padStart(2, "0")}-after-${text.replace(/[^a-z0-9]/gi, "")}.png`), fullPage: false });
  }

  fs.writeFileSync(path.join(outDir, "console.log"), consoleLog.join("\n"));
  await context.close();
  await browser.close();
  console.log("Output:", outDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
