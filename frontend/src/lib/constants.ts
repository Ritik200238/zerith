/**
 * Chain and contract configuration for Zerith on Fhenix (Ethereum Sepolia).
 * All 27 contracts below are deployed and live; addresses verified 2026-05-17.
 */

export const FHENIX_TESTNET = {
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  name: "Ethereum Sepolia",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  blockExplorer: "https://sepolia.etherscan.io",
  nativeCurrency: {
    name: "SepoliaETH",
    symbol: "ETH",
    decimals: 18,
  },
} as const;

/** Deployed contract addresses — Ethereum Sepolia (chainId 11155111).
 *  Wave 3 redeploy v2 (2026-05-01): includes Phase C audit fixes
 *  (LimitOrderEngine settle-to-self removed, OTC/OrderBook price multiplication,
 *  Freelance refund no-ops removed, AuctionClaim MINTER_ROLE auto-granted,
 *  Vault delegateBalanceRead added, Reputation Sybil fix, Vickrey zero-bid
 *  edge case, getCount view functions added).
 */
export const CONTRACTS = {
  ConfidentialToken: "0xad1c3aCAB5794a7dE857D85e4098934235BA196a",
  PlatformRegistry: "0x5140Af056CbeDFbb1544d3769E6924f18E743dB2",
  SettlementVault: "0x8070C011260FcA24C9cB48DfE75804494677C3f7",
  OrderBook: "0x2Ec736dDe1F645bc65A01de198A09BdC3B510FB8",
  AuctionClaim: "0x707aB4D6d18d985b59146BF9c2e1d8D565A0bBA6",
  SealedAuction: "0x7BCDd0eff87D447bD50C42aEAC8f0D4dcEeEe32c", // Redeployed 2026-05-17 with Blind Floor
  Escrow: "0x9ec7cEd2bFab218C3270027D385CeF26627Cad25",
  LimitOrderEngine: "0xa4B36Ae83Df3B4947D4451b13BE4331A37Ca2CD0",
  BatchAuction: "0xb9364c0CF31915D0873F60750d7E667243Ce1f95",
  PortfolioTracker: "0xB16Fc2b5246dD7d2542E46F14BDED1aA947fA8f1",
  Reputation: "0x42ea9650f9fFAbF39c86497c5C0154fa93002161",
  OTCBoard: "0xBf90003e63De9a042Bd4C13C5cd00548616349eb", // Redeployed 2026-05-17 — encrypted overflow guard + expireRequest
  PrivatePayments: "0x45a963867CE03f64c09e45312a74f0B7ca425678",
  FreelanceBidding: "0x2505450Fb9331cCaA626E9cA11423835C08b3B8C",
  VickreyAuction: "0x68fBEB96988e3314a16A7aaE09E9561435893ABA",
  DutchAuction: "0xF68858D52fFf0784F5EdE582952639c79B1161e7",
  OverflowSale: "0xd199fFCED0E4F417e32573D871770860e405567f",
  TokenVesting: "0x6A9500bFF2fc980F0Ad33a83b202EA061fEE1ea1",
  AllowlistGate: "0x7214B8219A83b248AaBfDf84b284DedB7e1D7F91",
  Referrals: "0x4b6F242e207104e34de4f6544D34f0A7780495fc",
  // Wave 4 + W5+ — deployed 2026-05-02 on top of v2 baseline.
  Organization: "0x66E6e2e0dC9E4d486c36C494c620B687e18FCeA7",
  EncryptedStreaming: "0x2D1F98B56e1E5299EB6A7cCdf18C460Fa4a89998",
  ConfidentialMultisig: "0xB71E9c2d096597DB50003Fe85d755119A3617277",
  EncryptedRoyalty: "0xc1926ae9A6BF2bbdADbcFA8Cf40ca0DCB9739cf6",
  // F2 + F6 — deployed 2026-05-02
  ConfidentialWrapper: "0x7Cb515093392Af34cF14c654dbA666422420Df42",
  EncryptedRaffle: "0xEADb49571BCA5188d9AEe0DB7b7154eD118Af1b1",
  // ProofOfReserves — deployed 2026-05-17 on Eth Sepolia
  ProofOfReserves: "0x02F6EEcA72cBA136562d7a30d4F4EFF15d1CDB4F",
} satisfies Record<string, string>;

export type ContractName = keyof typeof CONTRACTS;

/** Token metadata */
export const TOKEN_CONFIG = {
  // Verified on-chain 2026-05-17 against ConfidentialToken at 0xad1c…BA196a:
  // name() = "Zerith Token", symbol() = "CDEX". Stale "Sigil" labels removed.
  name: "Zerith Token",
  symbol: "CDEX",
  decimals: 18,
  faucetAmount: "1000", // Amount minted per faucet call (human-readable)
} as const;

/** V1 navigation — Phase 2 routes hidden but their pages still exist at their URLs. */
export const NAV_ITEMS = [
  // Overview — entry surfaces every user sees on connect.
  { label: "Dashboard", href: "/", icon: "LayoutDashboard", group: "Overview" },
  { label: "Treasury", href: "/treasury", icon: "Vault", group: "Overview" },
  { label: "Activity", href: "/activity", icon: "Activity", group: "Overview" },

  // Token Launch — the auction family. Suite picker first; individual mechanisms below.
  { label: "Auction Suite", href: "/auctions-suite", icon: "Layers", group: "Token Launch" },
  { label: "Sealed", href: "/auctions", icon: "Gavel", group: "Token Launch" },
  { label: "Vickrey", href: "/vickrey", icon: "Eye", group: "Token Launch" },
  { label: "Dutch", href: "/dutch", icon: "TrendingDown", group: "Token Launch" },
  { label: "Batch", href: "/batch", icon: "Layers", group: "Token Launch" },
  { label: "Overflow", href: "/overflow", icon: "Droplets", group: "Token Launch" },

  // Finance — the wedge (Payments). Streaming/Vesting/Royalty/Freelance hidden for v1.
  { label: "Payments", href: "/payments", icon: "CreditCard", group: "Finance" },

  // Trading — OTC hero. Trade kept as P2P entry. Escrow + Limits hidden for v1.
  { label: "OTC", href: "/otc", icon: "Users", group: "Trading" },
  { label: "Trade", href: "/trade", icon: "ArrowLeftRight", group: "Trading" },

  // Analytics — judge-facing privacy dashboard, agent demo, reputation peek.
  { label: "Audit", href: "/audit", icon: "Shield", group: "Analytics" },
  { label: "Agent", href: "/agent", icon: "Sparkles", group: "Analytics" },
  { label: "Reputation", href: "/reputation", icon: "Star", group: "Analytics" },

  // ── HIDDEN FROM V1 NAV (pages still live at their URLs; surface in Phase 2) ──
  // /portfolio    — superseded by /treasury for v1
  // /streaming    — Phase 2 (recurring payroll upsell)
  // /vesting      — Phase 2 (encrypted vesting schedules)
  // /royalty      — Phase 2 (creator royalties)
  // /freelance    — Phase 2 (encrypted bidding + disputes)
  // /escrow       — Phase 2 (generic escrow)
  // /limits       — Phase 2 (limit-order engine)
  // /raffle       — Phase 2 (encrypted raffles)
  // /allowlist    — Phase 2 (Merkle whitelist)
  // /wrapper      — Phase 2 (confidential token wrapper)
  // /multisig     — Phase 2 (confidential multisig)
  // /org          — Phase 2 (encrypted DAO governance)
  // /referrals    — Phase 2 (encrypted referral rewards)
] as const;

/** Encryption stage labels for progress display.
 *  These mirror the cofhejs.encrypt() pipeline: each label tells the user
 *  exactly which step the WASM is on, in plain English. */
export const ENCRYPT_STAGES = [
  { key: "extract", label: "Reading" },
  { key: "pack", label: "Packing" },
  { key: "prove", label: "Proving" },
  { key: "verify", label: "Verifying" },
  { key: "replace", label: "Sealing" },
  { key: "done", label: "Sealed" },
] as const;

/** Polling / timeout config for async FHE operations */
export const FHE_ASYNC = {
  pollIntervalMs: 3000,
  timeoutMs: 60000,
} as const;
