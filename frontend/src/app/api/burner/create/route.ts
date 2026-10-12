/**
 * POST /api/burner/create   body: { address: "0x…" }
 *
 * Gas top-up for the embedded demo burner ("Try it instantly").
 *
 * The burner's private key is generated and stored in the BROWSER. This route
 * never sees it — it only receives the public address and sends it enough
 * Sepolia ETH for gas. Everything else (faucet, vault authorization) the burner
 * does itself, client-side, as normal signed transactions.
 *
 * Idempotent: if the address already holds enough ETH, nothing is sent. So a
 * retry after a timeout, or a returning visitor, never double-spends the funder.
 *
 * Abuse controls (all fail closed):
 *   - Same-origin only (Origin must match the request host).
 *   - Per-IP and per-address windows, recorded only AFTER a successful top-up,
 *     so a failed request never locks a user out.
 *   - A global per-hour cap on top-ups.
 *   - The amount tracks live gas prices and is capped, so a drained funder
 *     costs little and a gas spike doesn't leave burners stranded.
 * Limits use Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (shared
 * across all serverless instances); otherwise a per-instance in-memory store.
 *
 * Env:
 *   - BURNER_FUNDER_PRIVATE_KEY   hot wallet that pays for gas (required)
 *   - SEPOLIA_RPC_URL             JSON-RPC for ethSepolia (chainId 11155111)
 *   - BURNER_MAX_FUND_ETH         upper bound per top-up, default "0.005"
 *   - BURNER_MIN_FUND_ETH         lower bound per top-up, default "0.0002"
 *   - BURNER_IP_WINDOW_MS         default 6h
 *   - BURNER_HOURLY_CAP           default 60 top-ups per hour
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   optional
 */

import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One funding tx + one confirmation (~12-25s on Sepolia).
export const maxDuration = 60;

const CHAIN_ID = 11155111;
// Gas budget a burner should be able to afford: ~40 FHE-heavy txs at ~2M gas.
const GAS_BUDGET = BigInt(80_000_000);
const IP_WINDOW_MS = Number(process.env.BURNER_IP_WINDOW_MS ?? 6 * 60 * 60 * 1000);
const HOURLY_CAP = Number(process.env.BURNER_HOURLY_CAP ?? 60);

/* ---------- Limits store: Upstash if configured, else per-instance memory ---------- */

const memory = new Map<string, number>(); // key → expiry (ms epoch) or counter

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(upstashUrl!, {
    method: "POST",
    headers: { Authorization: `Bearer ${upstashToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

/** Remaining lock in ms for `key`, or 0 if free. */
async function lockRemaining(key: string): Promise<number> {
  if (upstashUrl && upstashToken) {
    const ttl = Number(await upstash(["PTTL", key]));
    return ttl > 0 ? ttl : 0;
  }
  const until = memory.get(key) ?? 0;
  return Math.max(0, until - Date.now());
}

async function setLock(key: string, ms: number): Promise<void> {
  if (upstashUrl && upstashToken) {
    await upstash(["SET", key, 1, "PX", ms]);
    return;
  }
  memory.set(key, Date.now() + ms);
}

async function hourlyCount(bump: boolean): Promise<number> {
  const key = `burner:hour:${Math.floor(Date.now() / 3_600_000)}`;
  if (upstashUrl && upstashToken) {
    if (!bump) return Number((await upstash(["GET", key])) ?? 0);
    const n = Number(await upstash(["INCR", key]));
    if (n === 1) await upstash(["EXPIRE", key, 3600]);
    return n;
  }
  const n = (memory.get(key) ?? 0) + (bump ? 1 : 0);
  memory.set(key, n);
  return n;
}

/* ---------- Helpers ---------- */

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, message, ...extra }, { status });
}

/* ---------- Handler ---------- */

export async function POST(req: NextRequest) {
  const funderKey = process.env.BURNER_FUNDER_PRIVATE_KEY;
  if (!funderKey) {
    return fail(503, "demo_not_configured", "Instant demo wallets aren't set up on this deployment. Connect MetaMask instead.");
  }
  if (!sameOrigin(req)) {
    return fail(403, "forbidden", "Requests must come from the Zerith app.");
  }

  let address: string;
  try {
    const body = (await req.json()) as { address?: unknown };
    if (typeof body.address !== "string" || !ethers.isAddress(body.address)) throw new Error();
    address = ethers.getAddress(body.address);
  } catch {
    return fail(400, "bad_request", "Missing or invalid wallet address.");
  }

  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      CHAIN_ID,
      { staticNetwork: true },
    );

    // Size the top-up from live gas prices, clamped to configured bounds.
    const fee = await provider.getFeeData();
    const perGas = fee.maxFeePerGas ?? fee.gasPrice ?? ethers.parseUnits("1", "gwei");
    const minFund = ethers.parseEther(process.env.BURNER_MIN_FUND_ETH ?? "0.0002");
    const maxFund = ethers.parseEther(process.env.BURNER_MAX_FUND_ETH ?? "0.005");
    let target = perGas * GAS_BUDGET;
    if (target < minFund) target = minFund;
    if (target > maxFund) target = maxFund;

    // Idempotent: already has enough gas → nothing to do.
    const current = await provider.getBalance(address);
    if (current * BigInt(2) >= target) {
      return NextResponse.json({ address, funded: false, balanceEth: ethers.formatEther(current) });
    }

    const ip = getClientIp(req);
    const [ipWait, addrWait] = await Promise.all([
      lockRemaining(`burner:ip:${ip}`),
      lockRemaining(`burner:addr:${address}`),
    ]);
    const wait = Math.max(ipWait, addrWait);
    if (wait > 0) {
      return fail(
        429,
        "rate_limited",
        `This network already received free test ETH recently. Try again in about ${Math.ceil(wait / 60_000)} minutes, or connect MetaMask with your own Sepolia ETH.`,
        { retryInSeconds: Math.ceil(wait / 1000) },
      );
    }
    if ((await hourlyCount(false)) >= HOURLY_CAP) {
      return fail(429, "busy", "Lots of people are trying Zerith right now. Try again in a few minutes, or connect MetaMask.");
    }

    const funder = new ethers.Wallet(funderKey, provider);
    const value = target - current;
    const funderBal = await provider.getBalance(funder.address);
    if (funderBal < value + ethers.parseEther("0.0002")) {
      console.error("[burner.create] funder balance too low:", ethers.formatEther(funderBal));
      return fail(
        503,
        "demo_out_of_funds",
        "The demo gas wallet is empty right now. Connect MetaMask with Sepolia ETH from a public faucet, or try again later.",
      );
    }

    const tx = await funder.sendTransaction({ to: address, value });
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) {
      return fail(502, "funding_failed", "The gas top-up didn't confirm. Try again.", { txHash: tx.hash });
    }

    // Record limits only after the user actually got something. A limits-store
    // hiccup here must not turn a successful top-up into an error response.
    await Promise.all([
      setLock(`burner:ip:${ip}`, IP_WINDOW_MS),
      setLock(`burner:addr:${address}`, IP_WINDOW_MS),
      hourlyCount(true),
    ]).catch((e) => console.error("[burner.create] limit record failed:", e instanceof Error ? e.message : e));

    return NextResponse.json({
      address,
      funded: true,
      fundedTxHash: tx.hash,
      fundedAmountEth: ethers.formatEther(value),
    });
  } catch (err) {
    // Never echo inner details (RPC URLs, partial state) to the client.
    console.error("[burner.create] failed:", err instanceof Error ? err.message : err);
    return fail(500, "internal_error", "Couldn't send test ETH right now. Try again in a moment, or connect MetaMask.");
  }
}
