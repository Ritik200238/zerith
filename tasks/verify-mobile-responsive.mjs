// Mobile responsive sweep — 375x812 (iPhone 14) viewport across every route.
//
// CI mode (default): visits each route, measures `documentElement.scrollWidth`,
// and exits with code 1 if any page overflows the 375px viewport. Captures
// a screenshot for any overflow case so the failure is debuggable from the
// CI artifact.
//
// Local mode (`--archive`): also captures screenshots for every route, even
// ones that pass, and writes them to verification-evidence/mobile/ for the
// manual visual archive.
//
// CI does not need a burner wallet — pages render in the disconnected
// state with the wallet-connect CTA visible, which is enough to detect
// layout overflow. Local archive runs may attach a burner if .burner-wallet.json
// is present.

import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE_URL ?? "https://zerith-fi.vercel.app";
const VIEWPORT_WIDTH = 375;
const ARCHIVE = process.argv.includes("--archive");

const ROUTES = [
  ["00-landing", "/"],
  ["01-treasury", "/treasury"],
  ["02-payments", "/payments"],
  ["03-auctions", "/auctions"],
  ["04-auctions-suite", "/auctions-suite"],
  ["05-activity", "/activity"],
  ["06-otc", "/otc"],
  ["07-multisig", "/multisig"],
  ["08-agent", "/agent"],
  ["09-vickrey", "/vickrey"],
  ["10-dutch", "/dutch"],
  ["11-batch", "/batch"],
  ["12-overflow", "/overflow"],
  ["13-freelance", "/freelance"],
  ["14-trade", "/trade"],
  ["15-streaming", "/streaming"],
  ["16-org", "/org"],
  ["17-allowlist", "/allowlist"],
  ["18-vesting", "/vesting"],
  ["19-raffle", "/raffle"],
  ["20-wrapper", "/wrapper"],
  ["21-portfolio", "/portfolio"],
  ["22-reputation", "/reputation"],
  ["23-referrals", "/referrals"],
  ["24-royalty", "/royalty"],
  ["25-escrow", "/escrow"],
  ["26-limits", "/limits"],
  ["27-audit", "/audit"],
  ["28-contact", "/contact"],
  ["29-why-cdex", "/why-cdex"],
  ["30-more", "/more"],
];

async function main() {
  const outDir = path.join(ROOT, "verification-evidence", "mobile");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 14"],
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: "zerith-onboarding-seen-v2", value: "1" },
            { name: "zerith-onboarding-seen", value: "1" },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();

  const overflows = [];

  for (const [idx, route] of ROUTES) {
    process.stdout.write(`[mobile] ${route.padEnd(22)}`);
    try {
      await page.goto(`${BASE}${route}?_cb=${Date.now()}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      // Allow client-rendered pages (use client + force-dynamic) to settle.
      await page.waitForTimeout(2000);

      const metric = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;
        return {
          scrollWidth: Math.max(
            html.scrollWidth,
            body ? body.scrollWidth : 0,
          ),
          clientWidth: html.clientWidth,
        };
      });

      const overflowsViewport = metric.scrollWidth > VIEWPORT_WIDTH + 1; // 1px tolerance for scrollbar
      const wantsScreenshot = ARCHIVE || overflowsViewport;
      if (wantsScreenshot) {
        await page.screenshot({
          path: path.join(outDir, `${idx}.png`),
          fullPage: true,
        });
      }

      if (overflowsViewport) {
        overflows.push({ route, ...metric });
        console.log(
          ` FAIL · scrollWidth=${metric.scrollWidth}px > ${VIEWPORT_WIDTH}px`,
        );
      } else {
        console.log(` OK   · scrollWidth=${metric.scrollWidth}px`);
      }
    } catch (e) {
      console.log(` ERR  · ${e?.message?.slice(0, 80) ?? e}`);
      overflows.push({ route, error: String(e?.message ?? e) });
    }
  }

  await context.close();
  await browser.close();

  console.log("");
  if (overflows.length > 0) {
    console.log(`[mobile] FAIL — ${overflows.length} route(s) overflow 375px:`);
    for (const o of overflows) {
      console.log(`  ${o.route} · ${JSON.stringify(o)}`);
    }
    console.log(`[mobile] screenshots in ${outDir}`);
    process.exit(1);
  }
  console.log(`[mobile] PASS — every route fits in ${VIEWPORT_WIDTH}px viewport.`);
  if (ARCHIVE) {
    console.log(`[mobile] archive screenshots in ${outDir}`);
  }
}

main().catch((e) => {
  console.error("[mobile] uncaught:", e);
  process.exit(1);
});
