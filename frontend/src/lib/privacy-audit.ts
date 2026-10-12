/**
 * Privacy Audit Metadata — single source of truth for the `/audit` page.
 *
 * Documents, for every contract in the core product:
 *   - which fields are stored as encrypted handles (euint*, eaddress, ebool)
 *   - which fields are public
 *   - which FHE library calls the contract makes — generated from the Solidity
 *     source by `copy-abis.js` into fhe-ops.json, never typed by hand
 *   - which view function exposes a public count
 *   - the privacy stage (1, 2, or 3)
 *
 * Stages:
 *   - Stage 1 — no encrypted state
 *   - Stage 2 — encrypted at rest; only the outcome is decrypted (e.g. the winning bid)
 *   - Stage 3 — never decrypted on-chain; only the owner can unseal with their ACP
 *
 * Paused features (legacy-contracts/) are not listed: they aren't part of the
 * running product.
 */

import type { ContractName } from "./constants";
import FHE_OPS from "./fhe-ops.json";

export type PrivacyStage = 1 | 2 | 3;

export interface PrivacyDescriptor {
  /** Friendly label shown in the UI. */
  title: string;
  /** Short purpose description. */
  purpose: string;
  /** Stage 1/2/3 — how privacy maps over time. */
  stage: PrivacyStage;
  /** Fields whose ciphertext lives on-chain forever, or until reveal. */
  encryptedFields: string[];
  /** Fields stored as plaintext on-chain (intentionally public). */
  publicFields: string[];
  /** FHE library calls this contract makes (from the source). */
  fheOps: string[];
  /** View function returning a public count, or null. */
  countGetter: string | null;
  /** Plural noun for the count. */
  countLabel: string | null;
  /** Whether outcomes are published with Threshold Network signatures. */
  emitsReveals: boolean;
}

const ops = (name: keyof typeof FHE_OPS): string[] => FHE_OPS[name] ?? [];

export const PRIVACY_AUDIT: Partial<Record<ContractName, PrivacyDescriptor>> = {
  SealedAuction: {
    title: "Sealed-Bid Block Sale",
    purpose:
      "Sell a public lot to the highest sealed bid. Bids and the lot are escrowed in the vault, so settlement is atomic. Only the winning bid is ever decrypted; losers are refunded as ciphertext.",
    stage: 2,
    encryptedFields: [
      "bids[auction][bidder] (amount actually locked)",
      "highestBid, highestBidder (until reveal)",
      "Blind Floor reserve (never decrypted)",
      "lotLocked, lotFunded",
    ],
    publicFields: ["seller", "lot token + size", "payment token", "deadline", "bid count", "status", "winner + winning bid after reveal"],
    fheOps: ops("SealedAuction"),
    countGetter: "getAuctionCount",
    countLabel: "auctions",
    emitsReveals: true,
  },

  SettlementVault: {
    title: "Settlement Vault",
    purpose:
      "Encrypted balance ledger and escrow. Deposits credit only what actually arrived; feature contracts lock funds when users commit and can pay out only what they locked.",
    stage: 3,
    encryptedFields: ["balance(user, token)", "escrow(settler, token)"],
    publicFields: ["supported tokens", "authorized settlers", "owner"],
    fheOps: ops("SettlementVault"),
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  PrivatePayments: {
    title: "Private Payroll",
    purpose:
      "Encrypted multi-recipient payroll. The whole split is locked from the creator up front; each recipient can unseal only their own amount, and the total stays encrypted.",
    stage: 3,
    encryptedFields: ["amount per recipient", "split total"],
    publicFields: ["creator", "token", "recipient list", "claimed count", "status"],
    fheOps: ops("PrivatePayments"),
    countGetter: "getSplitCount",
    countLabel: "splits",
    emitsReveals: false,
  },

  ProofOfReserves: {
    title: "Proof of Reserves",
    purpose:
      "Prove \"my vault balance was at least X at this time\" without revealing the balance. The comparison runs on ciphertext; only the yes/no outcome is published, with a Threshold Network signature.",
    stage: 2,
    encryptedFields: ["vault balance (compared inside the vault)", "outcome (until reveal)"],
    publicFields: ["prover", "token", "threshold", "requested at", "outcome after reveal"],
    fheOps: ops("ProofOfReserves"),
    countGetter: "getClaimCount",
    countLabel: "claims",
    emitsReveals: true,
  },

  ConfidentialToken: {
    title: "Test Token (FHERC-20)",
    purpose:
      "The CDEX test token: encrypted balances with a public faucet. Built from fhenix-confidential-contracts 0.2.0.",
    stage: 3,
    encryptedFields: ["confidentialBalanceOf(address)", "total supply"],
    publicFields: ["name", "symbol", "decimals", "balance indicator (not the amount)", "operators"],
    fheOps: ops("ConfidentialToken"),
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  PlatformRegistry: {
    title: "Platform Registry",
    purpose: "Fee schedule, fee collector and the emergency pause.",
    stage: 1,
    encryptedFields: [],
    publicFields: ["fee (bps)", "fee collector", "paused"],
    fheOps: ops("PlatformRegistry"),
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },
};

/** Operations that compute on ciphertext (as opposed to access control or conversion). */
const COMPUTE_OPS = new Set(["add", "sub", "mul", "div", "select", "gt", "gte", "lt", "lte", "eq", "ne", "max", "min", "and", "or", "xor", "not"]);

/** Every distinct FHE call made by the core contracts. */
export function aggregateFheOps(): string[] {
  const set = new Set<string>();
  for (const desc of Object.values(PRIVACY_AUDIT)) desc?.fheOps.forEach((op) => set.add(op));
  return Array.from(set).sort();
}

/** The subset of aggregateFheOps() that computes on encrypted values. */
export function aggregateComputeOps(): string[] {
  return aggregateFheOps().filter((op) => COMPUTE_OPS.has(op));
}

/** Count distinct contracts that use FHE. */
export function fheContractCount(): number {
  return Object.values(PRIVACY_AUDIT).filter((d) => d && d.fheOps.length > 0).length;
}
