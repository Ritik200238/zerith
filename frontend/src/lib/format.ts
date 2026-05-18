/**
 * Number / address formatting utilities.
 *
 * Audit fix F5: pages were displaying raw uint128 values like
 * "1000000000000000000" instead of human-readable "1.0". This module
 * centralizes formatting so every page is consistent.
 */

import { ethers } from "ethers";
import { TOKEN_CONFIG } from "./constants";

/**
 * Format a raw token amount (in smallest units, e.g. wei) for display.
 * Trims trailing zeros, never shows scientific notation, falls back to "—" on error.
 */
export function formatAmount(
  raw: bigint | string | number | null | undefined,
  decimals: number = TOKEN_CONFIG.decimals,
  maxFractionDigits = 4,
): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  try {
    const bn = typeof raw === "bigint" ? raw : BigInt(raw);
    if (bn === BigInt(0)) return "0";
    const formatted = ethers.formatUnits(bn, decimals);
    // Trim trailing zeros, cap fraction digits
    const num = Number(formatted);
    if (Number.isFinite(num)) {
      // Sanity guard: anything ≥ 10^12 is almost certainly residue from
      // a pre-decimals-fix on-chain value (10^18 scaled at decimals=6 =
      // 10^12). Display as 'Legacy' instead of leaking misleading huge
      // numbers like '100000.00B CDEX' that confuse users about state.
      if (num >= 1e12) return "Legacy";
      // For large numbers, abbreviate
      if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
      // Trim fraction
      return num.toLocaleString(undefined, {
        maximumFractionDigits: maxFractionDigits,
        minimumFractionDigits: 0,
      });
    }
    return formatted;
  } catch {
    return String(raw);
  }
}

/** Format an amount + symbol pair, e.g. "1,250 CDEX". */
export function formatAmountWithSymbol(
  raw: bigint | string | number | null | undefined,
  symbol: string = TOKEN_CONFIG.symbol,
  decimals: number = TOKEN_CONFIG.decimals,
): string {
  return `${formatAmount(raw, decimals)} ${symbol}`;
}

/**
 * Parse a human-readable amount (e.g. "1.5") to bigint smallest-units.
 * Validates the input is a sane number. Returns null on invalid input.
 *
 * Audit fix F6: prevents `BigInt("1.5")` crashes that previously bricked
 * encryption mid-tx.
 */
export function parseAmount(
  input: string,
  decimals: number = TOKEN_CONFIG.decimals,
): bigint | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Reject anything that's not a positive number with optional decimal part
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    return ethers.parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

/** Shortened address: 0x1234...abcd. Consistent across the whole app. */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr || typeof addr !== "string") return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Validate Ethereum address — basic 0x + 40 hex chars.
 * Use before submitting any user-typed address to a contract.
 */
export function isValidAddress(addr: string | null | undefined): addr is string {
  if (!addr || typeof addr !== "string") return false;
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * Format a unix timestamp as relative time (e.g. "2h 30m ago", "in 5m").
 * Negative remaining → "Expired".
 */
export function formatRemaining(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixSeconds - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${diff}s`;
}
