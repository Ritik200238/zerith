/**
 * Privacy Audit Metadata — single source of truth for `/audit` page.
 *
 * Documents, for every deployed contract:
 *   - which fields are stored as encrypted handles (euint*, eaddress)
 *   - which fields are public (uint, address, bool)
 *   - which FHE ops the contract uses
 *   - which view function exposes a public count (or null if none)
 *   - the privacy stage (1, 2, or 3)
 *
 * Stages:
 *   - Stage 1 — encrypted in transit, plaintext on chain (commit-reveal, etc.)
 *   - Stage 2 — encrypted at rest, decrypted only on settlement
 *   - Stage 3 — never decrypted; permits only (end-to-end encrypted)
 *
 * This file is the "schema" half. The /audit page reads these descriptors
 * and pulls the live counts at render time.
 */

import type { ContractName } from "./constants";

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
  /** FHE library calls this contract uses. */
  fheOps: string[];
  /**
   * Solidity function name that returns a public scalar count, used to
   * surface "12 sealed auctions live" style metrics. null when no such getter
   * exists yet.
   */
  countGetter: string | null;
  /** Optional human-readable noun for the count, plural. */
  countLabel: string | null;
  /**
   * Whether this contract emits a `RevealPublished` event we want to surface
   * on the audit page. Most decrypt-flow contracts do.
   */
  emitsReveals: boolean;
}

export const PRIVACY_AUDIT: Partial<Record<ContractName, PrivacyDescriptor>> = {
  ConfidentialToken: {
    title: "Confidential Token (FHERC-20)",
    purpose: "Encrypted-balance ERC-20 with built-in faucet.",
    stage: 3,
    encryptedFields: ["confidentialBalanceOf(address)", "confidentialTotalSupply()"],
    publicFields: ["name", "symbol", "decimals", "balanceOf (0.0000–0.9999 indicator only)", "operators (setOperator)"],
    fheOps: ["asEuint64", "add", "sub", "select", "allowThis", "allow"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  SettlementVault: {
    title: "Settlement Vault",
    purpose: "Encrypted balance ledger; settles trades atomically.",
    stage: 3,
    encryptedFields: ["balances(token, user)"],
    publicFields: ["pause state", "platform admin"],
    fheOps: ["asEuint64", "add", "sub", "select", "gte", "allowThis", "allow"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  ProofOfReserves: {
    title: "Proof of Reserves",
    purpose: "Prove \"I hold ≥ X\" against an encrypted vault balance, without revealing the exact amount. Outcome revealed via Threshold Network signature.",
    stage: 2,
    encryptedFields: ["vault balance (via delegateBalanceRead)", "encResult (1/0 until reveal)"],
    publicFields: ["prover", "token", "threshold", "status"],
    fheOps: ["asEuint64", "gte", "select", "allowThis", "allowGlobal", "publishDecryptResult"],
    countGetter: "getClaimCount",
    countLabel: "claims",
    emitsReveals: true,
  },

  SealedAuction: {
    title: "Sealed-Bid Auction",
    purpose: "Highest-bid wins, anti-snipe timer.",
    stage: 2,
    encryptedFields: ["bids[bidder].amount", "highestBid", "winner (until reveal)"],
    publicFields: ["seller", "token pair", "deadline", "bidCount", "status"],
    fheOps: ["asEuint128", "gt", "max", "select", "allowGlobal", "publishDecryptResult"],
    countGetter: "getAuctionCount",
    countLabel: "auctions",
    emitsReveals: true,
  },

  VickreyAuction: {
    title: "Vickrey (2nd-Price) Auction",
    purpose: "Highest wins, pays 2nd-highest. Truthful bidding.",
    stage: 2,
    encryptedFields: [
      "bids[bidder].amount",
      "highestBid (until reveal)",
      "secondBid (until reveal)",
      "winner (until reveal)",
    ],
    publicFields: ["seller", "token pair", "deadline", "bidCount"],
    fheOps: ["asEuint128", "gt", "select", "allowGlobal", "publishDecryptResult"],
    countGetter: "getAuctionCount",
    countLabel: "auctions",
    emitsReveals: true,
  },

  DutchAuction: {
    title: "Dutch Auction",
    purpose: "Price decays linearly; buy at current price.",
    stage: 2,
    encryptedFields: ["purchases[buyer].amount"],
    publicFields: ["startPrice", "endPrice", "duration", "buyerCount"],
    fheOps: ["asEuint64", "min", "allowGlobal", "publishDecryptResult"],
    countGetter: "getAuctionCount",
    countLabel: "auctions",
    emitsReveals: true,
  },

  BatchAuction: {
    title: "Batch / Clearing-Price Auction",
    purpose: "Uniform clearing price where supply meets demand.",
    stage: 2,
    encryptedFields: ["orders[bidder].amount", "clearingPrice (until reveal)"],
    publicFields: ["seller", "token pair", "totalSupply", "orderCount"],
    fheOps: ["asEuint64", "gte", "lte", "add", "select", "allowGlobal", "publishDecryptResult"],
    countGetter: "getAuctionCount",
    countLabel: "auctions",
    emitsReveals: true,
  },

  OverflowSale: {
    title: "Overflow Sale",
    purpose: "Fixed price; pro-rata allocation if oversubscribed.",
    stage: 2,
    encryptedFields: ["deposits[buyer].amount", "allocations[buyer].amount"],
    publicFields: ["price", "totalSupply", "depositorCount"],
    fheOps: ["asEuint64", "add", "min", "div(plain)", "allowGlobal", "publishDecryptResult"],
    countGetter: "getSaleCount",
    countLabel: "sales",
    emitsReveals: true,
  },

  PrivatePayments: {
    title: "Private Payments",
    purpose: "Per-recipient encrypted payouts. End-to-end encrypted.",
    stage: 3,
    encryptedFields: ["splits[id].recipientAmounts[recipient]"],
    publicFields: ["payer", "recipient list", "split template name"],
    fheOps: ["asEuint64", "add", "allowThis", "allow"],
    countGetter: "getSplitCount",
    countLabel: "splits",
    emitsReveals: false,
  },

  FreelanceBidding: {
    title: "Freelance Bidding",
    purpose: "Encrypted bids, milestone escrow, 3-voter dispute resolution.",
    stage: 2,
    encryptedFields: [
      "bids[bidder].price",
      "milestoneEscrow",
      "disputeVotes (until tally)",
    ],
    publicFields: ["title", "milestoneCount", "bidderCount", "status"],
    fheOps: ["asEuint128", "lt", "select", "asEuint8", "add", "allowGlobal", "publishDecryptResult"],
    countGetter: "getJobCount",
    countLabel: "jobs",
    emitsReveals: true,
  },

  OrderBook: {
    title: "Encrypted P2P Order Book",
    purpose: "Limit orders with encrypted prices.",
    stage: 2,
    encryptedFields: ["orders[id].price"],
    publicFields: ["maker", "token pair", "amount", "side", "status"],
    fheOps: ["asEuint128", "gte", "lte", "select", "allowGlobal", "publishDecryptResult"],
    countGetter: "getActiveOrderCount",
    countLabel: "active orders",
    emitsReveals: true,
  },

  OTCBoard: {
    title: "OTC Desk",
    purpose: "Private venue for large block trades.",
    stage: 2,
    encryptedFields: ["quotes[id].price", "quotes[id].amount"],
    publicFields: ["maker", "token pair", "expiry"],
    fheOps: ["asEuint128", "gte", "lte", "and", "select", "mul", "allowGlobal"],
    countGetter: null,
    countLabel: null,
    emitsReveals: true,
  },

  LimitOrderEngine: {
    title: "Limit Order Engine",
    purpose: "Continuous matching of encrypted limit orders.",
    stage: 2,
    encryptedFields: ["orders[id].price", "orders[id].amount"],
    publicFields: ["token pair", "side", "status"],
    fheOps: ["asEuint128", "lte", "gte", "or", "select", "allowGlobal"],
    countGetter: "getActiveOrderCount",
    countLabel: "active orders",
    emitsReveals: false,
  },

  Escrow: {
    title: "Escrow",
    purpose: "Conditional release; eq + and gating.",
    stage: 2,
    encryptedFields: ["amount", "release condition"],
    publicFields: ["payer", "payee", "status"],
    fheOps: ["asEuint128", "eq", "and", "select", "asEuint64", "allowThis", "allow", "allowTransient"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  Reputation: {
    title: "Encrypted Reputation",
    purpose: "Composable credit bureau. Ratings encrypted, score reveals on permit.",
    stage: 2,
    encryptedFields: ["scores[user]", "ratings[trader, counterparty]"],
    publicFields: ["tradeRecorded[tradeId]", "user list"],
    fheOps: ["asEuint8", "add", "div(plain)", "allowGlobal", "publishDecryptResult"],
    countGetter: null,
    countLabel: null,
    emitsReveals: true,
  },

  PortfolioTracker: {
    title: "Portfolio Tracker",
    purpose: "Encrypted portfolio valuation across vault balances.",
    stage: 3,
    encryptedFields: ["computed portfolio total"],
    publicFields: ["token list registered for tracker"],
    fheOps: ["mul", "add", "allowThis", "allow"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  TokenVesting: {
    title: "Token Vesting",
    purpose: "Cliff + linear vesting; encrypted grant amounts.",
    stage: 3,
    encryptedFields: ["grants[id].amount", "grants[id].released"],
    publicFields: ["beneficiary", "cliff", "duration"],
    fheOps: ["asEuint64", "sub", "div(plain)", "allowThis", "allow"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  AllowlistGate: {
    title: "Allowlist Gate",
    purpose: "Merkle-tree whitelist for gated launches.",
    stage: 1,
    encryptedFields: [],
    publicFields: ["merkleRoot", "claimedBitmap"],
    fheOps: [],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  Referrals: {
    title: "Encrypted Referrals",
    purpose: "FHE-private referral attribution + earnings.",
    stage: 3,
    encryptedFields: ["encTotalEarned[referrer]"],
    publicFields: ["root referrer registration", "referralCount[referrer]"],
    fheOps: ["asEuint64", "add", "allowThis", "allow"],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  AuctionClaim: {
    title: "Auction Claim NFT",
    purpose: "ERC-721 representing a tradeable auction position.",
    stage: 1,
    encryptedFields: [],
    publicFields: ["owner", "tokenId", "auctionId"],
    fheOps: [],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },

  ConfidentialWrapper: {
    title: "Confidential ERC-20 Wrapper",
    purpose: "Wrap ANY ERC-20 token into an encrypted-balance equivalent. Composability win.",
    stage: 3,
    encryptedFields: ["encBalance[token][user]"],
    publicFields: ["totalDeposited[token]", "initialized[token][user]"],
    fheOps: ["asEuint64", "add", "sub", "gte", "select", "allowThis", "allow", "allowGlobal", "publishDecryptResult"],
    countGetter: null,
    countLabel: null,
    emitsReveals: true,
  },

  EncryptedRaffle: {
    title: "Encrypted Raffle",
    purpose: "Public ticket buying, encrypted random winner via FHE.randomEuint64().",
    stage: 2,
    encryptedFields: ["encWinnerIndex[id]"],
    publicFields: ["raffles[id].creator", "raffles[id].deadline", "raffles[id].ticketCount", "participants[id][]"],
    fheOps: ["randomEuint64", "asEuint64", "rem", "allowThis", "allowGlobal", "publishDecryptResult"],
    countGetter: "getRaffleCount",
    countLabel: "raffles",
    emitsReveals: true,
  },

  EncryptedRoyalty: {
    title: "Encrypted Royalty Splits",
    purpose: "On-chain royalty registry where per-recipient % is encrypted. Distribution runs on ciphertext.",
    stage: 3,
    encryptedFields: ["encPercent[id][recipient]"],
    publicFields: ["royalties[id].creator", "royalties[id].token", "recipientLists[id]"],
    fheOps: ["asEuint64", "mul", "div", "allowThis", "allow", "allowTransient"],
    countGetter: "getRoyaltyCount",
    countLabel: "splits",
    emitsReveals: false,
  },

  ConfidentialMultisig: {
    title: "Confidential Multisig Vault",
    purpose: "Multisig where threshold + voting shares are encrypted; settlement runs on ciphertext.",
    stage: 3,
    encryptedFields: [
      "multisigs[id].threshold",
      "members[id][addr].share",
      "proposals[id][pid].amount",
      "proposals[id][pid].yesShares",
    ],
    publicFields: [
      "multisigs[id].creator",
      "multisigs[id].token",
      "memberCount",
      "proposals[id][pid].recipient",
      "proposals[id][pid].status",
    ],
    fheOps: ["asEuint64", "add", "gte", "select", "allowThis", "allow", "allowTransient"],
    countGetter: "getMultisigCount",
    countLabel: "vaults",
    emitsReveals: false,
  },

  EncryptedStreaming: {
    title: "Encrypted Streaming Payments",
    purpose: "Sablier-style streams with encrypted rate-per-second.",
    stage: 3,
    encryptedFields: ["streams[id].ratePerSecond"],
    publicFields: ["streams[id].payer", "streams[id].recipient", "streams[id].startTime", "streams[id].endTime", "streams[id].status"],
    fheOps: ["asEuint64", "mul", "allowThis", "allow", "allowTransient"],
    countGetter: "getStreamCount",
    countLabel: "streams",
    emitsReveals: false,
  },

  Organization: {
    title: "Organization",
    purpose: "DAO primitive — encrypted member weights + encrypted votes.",
    stage: 2,
    encryptedFields: [
      "encWeight[orgId][member]",
      "proposals[orgId][id].yesWeight",
      "proposals[orgId][id].noWeight",
    ],
    publicFields: [
      "orgs[orgId].name",
      "orgs[orgId].admin",
      "orgs[orgId].memberCount",
      "proposals[orgId][id].status",
      "proposals[orgId][id].deadline",
    ],
    fheOps: ["asEuint64", "add", "select", "allowThis", "allow", "allowGlobal", "publishDecryptResult"],
    countGetter: "getOrgCount",
    countLabel: "orgs",
    emitsReveals: true,
  },

  PlatformRegistry: {
    title: "Platform Registry",
    purpose: "User registry, fee schedule, pause control.",
    stage: 1,
    encryptedFields: [],
    publicFields: ["isUser", "feeBps", "paused"],
    fheOps: [],
    countGetter: null,
    countLabel: null,
    emitsReveals: false,
  },
};

/** Human-readable list of all FHE ops touched anywhere in the codebase. */
export function aggregateFheOps(): string[] {
  const set = new Set<string>();
  for (const desc of Object.values(PRIVACY_AUDIT)) {
    if (!desc) continue;
    desc.fheOps.forEach((op) => set.add(op));
  }
  return Array.from(set).sort();
}

/** Count distinct contracts that use FHE. */
export function fheContractCount(): number {
  return Object.values(PRIVACY_AUDIT).filter((d) => d && d.fheOps.length > 0).length;
}
