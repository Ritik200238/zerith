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
 *  Full redeploy 2026-05-18 with SettlementVault.deposit/withdraw fix:
 *  FHE.allowTransient(amount, token) before confidentialTransferFrom/Transfer
 *  so the token contract can read the encrypted amount handle inside its
 *  call (without this, ACLNotAllowed(handle, token) at gas estimation).
 *  All 26 contracts redeployed because the vault address is stored
 *  immutably in every feature's constructor.
 */
export const CONTRACTS = {
  ConfidentialToken: "0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2",
  PlatformRegistry: "0x0a97e158D0679A29321AB97A54AF666269C5F5A8",
  SettlementVault: "0x31B751027Ed82b489f42212371d17e30c4D655a5",
  OrderBook: "0x80b09409f2dB5FAEb45f2ca36C8C1b06772D45E2",
  AuctionClaim: "0xD46b298b4c4ce04E65b37a7F594D8C8e7876f65c",
  SealedAuction: "0xdEe59FD1d8Ac071146c7ED012a0a343FdD56b0A0",
  Escrow: "0x36dbcCAF465f106ebB3da7E9776b0598d4f36d32",
  LimitOrderEngine: "0x09A01EFA1e97c9f12F1Aa6Dc0dAf1b019a58F8E6",
  BatchAuction: "0xB29AF471E9392D0bAafc898795d7Ed6Bd6fBEfd5",
  PortfolioTracker: "0xe72F751B9FB60C542e352F82826f465FD3bc47a0",
  Reputation: "0xcbD4c5269219f3eE8a1C3Dbe0FB24d1F6558Ac09",
  OTCBoard: "0x808C27D12265234bE405Eb45800f2BDB1f4Cdb3D",
  PrivatePayments: "0x15309001612f1667C2Fc1De2107769F438712b4B",
  FreelanceBidding: "0xf71715fD9c9d314D56FBa0031EBc69ba22d5CE05",
  VickreyAuction: "0x12973Ac885A11136A9f948beCc6e810CF9D54e17",
  DutchAuction: "0xd9bA4b7b825f3558757Fe977d024b29e27B65b54",
  OverflowSale: "0x91b869Ba4Ad80683be67e7F2f776fFf655034Adb",
  TokenVesting: "0x1be9DF85c8cd48b98f7F0Cc75F565225f00E4895",
  AllowlistGate: "0xa9d8DA5D2878E8261A1f9c2c53dCA21e849c0EE4",
  Referrals: "0x77ef973642CC1BAE0756D20E25c83d5b5148af13",
  Organization: "0x088356c0ab2035605422f8B4Da2d4037487EC1DF",
  EncryptedStreaming: "0xa3076EF9395E2D7F81d9FB79Cd3E984449F938De",
  ConfidentialMultisig: "0x7250146635a9E0b60471037D6C7c51b21be28d36",
  EncryptedRoyalty: "0xD3AD70382cEcFdF291c060eE1fA17aE4Eb2DbF32",
  // ConfidentialWrapper + EncryptedRaffle were not redeployed (the wrapper
  // points at the new token implicitly via wrapper address, raffle doesn't
  // touch the vault) — keeping the older addresses as a deliberate carry-over.
  ConfidentialWrapper: "0x7Cb515093392Af34cF14c654dbA666422420Df42",
  EncryptedRaffle: "0xEADb49571BCA5188d9AEe0DB7b7154eD118Af1b1",
  ProofOfReserves: "0xFA609253c0CA0297e8c272543EE806CAC203bd70",
} satisfies Record<string, string>;

export type ContractName = keyof typeof CONTRACTS;

/** Token metadata */
export const TOKEN_CONFIG = {
  // Verified on-chain 2026-05-17 against ConfidentialToken at 0xad1c…BA196a:
  // name() = "Zerith Token", symbol() = "CDEX". Stale "Zerith" labels removed.
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
