// Record the 60-sec Zerith demo as a single Playwright video.
// Run: npx playwright install chromium --with-deps   # one-time
//      node tasks/record-60sec-demo.mjs
//
// Output: demo-video/<auto-name>.webm
//
// Beats:
//   00:00–05  Landing — hero "Every number, encrypted. Every operation, composable."
//   05–15     /auctions-suite — five sealed-bid mechanisms
//   15–25     /auctions — privacy report, headline "Highest wins. Losers learn nothing."
//   25–35     /treasury — sealed balance card + Proof of Reserves card
//   35–45     /payments — "Pay contributors, privately."
//   45–55     /activity — encrypted history feed
//   55–60     /auctions-suite again — back to the headline
//
// This is the editorial 'product is real and beautiful' clip. The 3-bidder
// reveal proof is on Etherscan (LAUNCH-QA-RESULTS B6) — this clip does not
// re-prove it on chain.

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIDEO_DIR = path.join(__dirname, "..", "demo-video");
mkdirSync(VIDEO_DIR, { recursive: true });

const BASE = "https://cipher-dex.vercel.app";

async function beat(page, url, hold) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  // Move mouse to a neutral spot to clear any hover state
  await page.mouse.move(800, 400);
  await page.waitForTimeout(hold);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1440, height: 900 },
    },
    // Suppress onboarding modal so it doesn't pop on every navigation
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
  const page = await context.newPage();

  console.log("Starting 60s demo recording at", BASE);
  console.log("Output:", VIDEO_DIR);

  const t0 = Date.now();

  await beat(page, "/", 4000);
  await beat(page, "/auctions-suite", 7000);
  await beat(page, "/auctions", 6000);
  await beat(page, "/treasury", 6000);
  await beat(page, "/payments", 6000);
  await beat(page, "/activity", 5000);
  await beat(page, "/auctions-suite", 4000);

  const t1 = Date.now();
  console.log(`Beats done in ${((t1 - t0) / 1000).toFixed(1)}s`);

  await context.close();
  await browser.close();

  console.log("✓ Video saved under", VIDEO_DIR);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
