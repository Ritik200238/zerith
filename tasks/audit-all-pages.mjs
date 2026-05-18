// Per-page audit — every route, capture console errors / warnings /
// failed network requests + final screenshot. Catches what the
// happy-path UI E2E missed.
//
// Run: node tasks/audit-all-pages.mjs

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

const ROUTES = [
  "/",
  "/treasury",
  "/payments",
  "/auctions",
  "/auctions-suite",
  "/activity",
  "/otc",
  "/dutch",
  "/vickrey",
  "/batch",
  "/overflow",
  "/freelance",
  "/trade",
  "/multisig",
  "/org",
  "/agent",
  "/portfolio",
  "/streaming",
  "/raffle",
  "/allowlist",
  "/audit",
  "/limits",
  "/escrow",
  "/reputation",
  "/referrals",
  "/royalty",
  "/vesting",
  "/wrapper",
];

function loadBurner() {
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const rpc = env.match(/SEPOLIA_RPC_URL\s*=\s*"?([^"\n\r]+)"?/)?.[1];
  const burnerJson = JSON.parse(fs.readFileSync(path.join(ROOT, ".burner-wallet.json"), "utf8"));
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(burnerJson.privateKey, provider);
  return { wallet, provider };
}

async function setupBurnerContext(browser) {
  const { wallet, provider } = loadBurner();
  const addr = await wallet.getAddress();
  const chainIdHex = "0x" + SEPOLIA_CHAIN_ID.toString(16);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [],
      origins: [{
        origin: BASE,
        localStorage: [
          { name: "zerith-onboarding-seen-v2", value: "1" },
          { name: "zerith-onboarding-seen", value: "1" },
        ],
      }],
    },
  });
  await context.exposeFunction("__burnerAddress", () => addr);
  await context.exposeFunction("__burnerChainIdHex", () => chainIdHex);
  await context.exposeFunction("__burnerPersonalSign", async (msgHex) => {
    let msg = msgHex;
    if (typeof msgHex === "string" && msgHex.startsWith("0x")) {
      msg = Buffer.from(msgHex.slice(2), "hex");
    }
    return wallet.signMessage(msg);
  });
  await context.exposeFunction("__burnerSignTypedData", async (domain, types, value) => {
    const cleanTypes = { ...types };
    delete cleanTypes.EIP712Domain;
    return wallet.signTypedData(domain, cleanTypes, value);
  });
  await context.exposeFunction("__burnerSendTransaction", async (tx) => {
    const sent = await wallet.sendTransaction({
      to: tx.to, from: tx.from, data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
      gasLimit: tx.gas ? BigInt(tx.gas) : undefined,
    });
    return sent.hash;
  });
  await context.exposeFunction("__burnerCall", async (tx) => provider.call({ to: tx.to, from: tx.from, data: tx.data }));
  await context.exposeFunction("__burnerRpc", async (method, params) => provider.send(method, params));
  await context.addInitScript(({ chainIdHex }) => {
    const listeners = {};
    const w = window;
    async function request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [await w.__burnerAddress()];
        case "eth_chainId": return chainIdHex;
        case "net_version": return String(parseInt(chainIdHex, 16));
        case "personal_sign": return await w.__burnerPersonalSign(params[0]);
        case "eth_signTypedData_v4":
        case "eth_signTypedData": {
          const raw = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          return await w.__burnerSignTypedData(raw.domain, raw.types, raw.message);
        }
        case "eth_sendTransaction": return await w.__burnerSendTransaction(params[0]);
        case "eth_call": return await w.__burnerCall(params[0]);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
        case "wallet_revokePermissions": return null;
        default: return await w.__burnerRpc(method, params);
      }
    }
    w.ethereum = { isMetaMask: true, request, on(e, c){(listeners[e]=listeners[e]||[]).push(c)}, removeListener(){}, enable: () => request({method:"eth_requestAccounts",params:[]}), _isBurnerShim: true };
    setTimeout(() => { (listeners.connect||[]).forEach(c => c({ chainId: chainIdHex })); }, 100);
  }, { chainIdHex });
  return context;
}

async function auditRoute(context, route) {
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
    else if (msg.type() === "warning") warnings.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("favicon")) {
      failedRequests.push(`${resp.status()} ${resp.url()}`);
    }
  });

  let loaded = false;
  let timedOut = false;
  try {
    await page.goto(`${BASE}${route}?_cb=${Date.now()}`, { waitUntil: "networkidle", timeout: 30000 });
    loaded = true;
  } catch (e) {
    timedOut = true;
  }
  await page.waitForTimeout(4000); // let async work fire

  await page.close();
  return { route, loaded, timedOut, errors, warnings, failedRequests };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await setupBurnerContext(browser);
  const results = [];

  for (const route of ROUTES) {
    console.log(`auditing ${route}…`);
    const r = await auditRoute(context, route);
    results.push(r);
    const errCount = r.errors.length;
    const failCount = r.failedRequests.length;
    console.log(`  loaded=${r.loaded} errors=${errCount} failedReq=${failCount}`);
    if (errCount) console.log("    e.g.", r.errors[0].slice(0, 120));
  }

  await context.close();
  await browser.close();

  const outDir = path.join(ROOT, "verification-evidence", "audit");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "console-audit.json"), JSON.stringify(results, null, 2));

  console.log("\n=== Summary ===");
  console.log(`Total routes: ${results.length}`);
  console.log(`Loaded: ${results.filter(r => r.loaded).length}`);
  console.log(`With errors: ${results.filter(r => r.errors.length > 0).length}`);
  console.log(`With failed requests: ${results.filter(r => r.failedRequests.length > 0).length}`);
  const errored = results.filter(r => r.errors.length > 0);
  if (errored.length) {
    console.log("\nPages with console errors:");
    for (const r of errored) {
      console.log(`  ${r.route}:`);
      for (const e of r.errors.slice(0, 3)) console.log(`    - ${e.slice(0, 200)}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
