/**
 * POST /api/burner/create
 *
 * Embedded burner wallet endpoint. Used by the "Try it instantly" demo flow.
 *
 * Server-side flow:
 *   1. Generate a fresh ethers Wallet (random privkey).
 *   2. Fund it with a small amount of Sepolia ETH from BURNER_FUNDER_PRIVATE_KEY.
 *   3. Return { address, privateKey } to the browser.
 *
 * The browser then stores the privkey in localStorage and uses it as a signer
 * via WalletProvider's burner mode. No MetaMask required.
 *
 * The privkey is NEVER persisted server-side and NEVER logged.
 *
 * Required env vars (set in frontend/.env.local locally, Vercel project env in prod):
 *   - BURNER_FUNDER_PRIVATE_KEY    privkey of the hot wallet that disburses ETH
 *   - SEPOLIA_RPC_URL              JSON-RPC for ethSepolia (chainId 11155111)
 *
 * Optional:
 *   - BURNER_FUND_AMOUNT_ETH       default "0.008"
 *   - BURNER_RATE_LIMIT_WINDOW_MS  default 21600000 (6h per IP)
 */

import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";

// Vercel: this is a Node.js function, not Edge. We need ethers v6 which uses
// Node crypto + bigint. Fluid Compute will handle this just fine.
export const runtime = "nodejs";
// Don't cache POST. Always run fresh.
export const dynamic = "force-dynamic";

// In-memory rate limiter. Vercel Fluid Compute reuses function instances
// across requests, so this gives best-effort per-instance protection.
// Combined with the small fund amount (~0.008 ETH), this is sufficient for a
// testnet demo. Production would use Upstash / KV instead.
const RATE_LIMIT_STORE = new Map<string, number>();
const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h per IP

// Best-effort prune so the store doesn't grow unbounded on long-lived instances.
function pruneRateLimit(windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [ip, ts] of RATE_LIMIT_STORE) {
    if (ts < cutoff) RATE_LIMIT_STORE.delete(ip);
  }
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function checkRateLimit(ip: string): { ok: boolean; retryInSeconds?: number } {
  const windowMs = Number(process.env.BURNER_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WINDOW_MS);
  pruneRateLimit(windowMs);
  const last = RATE_LIMIT_STORE.get(ip);
  const now = Date.now();
  if (last && now - last < windowMs) {
    return { ok: false, retryInSeconds: Math.ceil((windowMs - (now - last)) / 1000) };
  }
  RATE_LIMIT_STORE.set(ip, now);
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const funderKey = process.env.BURNER_FUNDER_PRIVATE_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const fundAmount = process.env.BURNER_FUND_AMOUNT_ETH ?? "0.008";

  if (!funderKey) {
    return NextResponse.json(
      {
        error: "demo_not_configured",
        message:
          "Demo mode is not configured on this deployment. Connect MetaMask instead, or contact the team.",
      },
      { status: 503 },
    );
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `You've already claimed a burner from this IP. Try again in ${Math.ceil((rl.retryInSeconds ?? 0) / 60)} minutes, or use the same burner key (saved in your browser).`,
        retryInSeconds: rl.retryInSeconds,
      },
      { status: 429 },
    );
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl, 11155111);
    const funder = new ethers.Wallet(funderKey, provider);

    // Generate a fresh burner. Never reused, never persisted server-side.
    const burner = ethers.Wallet.createRandom();

    const value = ethers.parseEther(fundAmount);

    // Fund the burner. Wait one confirmation so the browser can immediately
    // submit txs without nonce/balance surprises.
    const tx = await funder.sendTransaction({
      to: burner.address,
      value,
    });
    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      return NextResponse.json(
        { error: "funding_failed", message: "Funding transaction did not confirm. Try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      address: burner.address,
      privateKey: burner.privateKey,
      fundedTxHash: tx.hash,
      fundedAmountEth: fundAmount,
      chainId: 11155111,
    });
  } catch (err) {
    // Never echo back inner error details — they might include RPC endpoints
    // or partial state. Log internally and return a generic message.
    console.error("[burner.create] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error: "internal_error",
        message:
          "Could not create burner wallet right now. Try again in a moment, or connect MetaMask.",
      },
      { status: 500 },
    );
  }
}
