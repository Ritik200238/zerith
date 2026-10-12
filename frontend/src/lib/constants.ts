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
 *  October 2026: the core (tokens, registry, claim NFT, SettlementVault,
 *  SealedAuction, PrivatePayments, ProofOfReserves) runs on Fhenix CoFHE 1.0 with
 *  ERC-7984 tokens and escrowed settlement. Every other address belongs to a
 *  paused feature from the May 2026 deployment.
 */
export const CONTRACTS = {
  ConfidentialToken: "0x9233B71feB89Bddd14B30Ddc5de171541E9bBC90",
  PlatformRegistry: "0x3B7B81E6B2D6b2F4904Bef744fCfdcE3a8bc5616",
  SettlementVault: "0x28ab1735988cD549FfBC6ebE5383a5ae83534D17",
  OrderBook: "0x80b09409f2dB5FAEb45f2ca36C8C1b06772D45E2",
  AuctionClaim: "0x3065150c4fbf0dC767D3669F5a3B2Ad056be3De9",
  SealedAuction: "0x42C620C7014E5fe40b8C6B8c1bc12AAde1db47aB",
  Escrow: "0x36dbcCAF465f106ebB3da7E9776b0598d4f36d32",
  LimitOrderEngine: "0x09A01EFA1e97c9f12F1Aa6Dc0dAf1b019a58F8E6",
  BatchAuction: "0xB29AF471E9392D0bAafc898795d7Ed6Bd6fBEfd5",
  PortfolioTracker: "0xe72F751B9FB60C542e352F82826f465FD3bc47a0",
  Reputation: "0xcbD4c5269219f3eE8a1C3Dbe0FB24d1F6558Ac09",
  OTCBoard: "0x808C27D12265234bE405Eb45800f2BDB1f4Cdb3D",
  PrivatePayments: "0xD10f93f12c9bbd69a85d5ec654038CC8201fB49C",
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
  ProofOfReserves: "0x8b3df8FD07aBE76157CFbeb512600B6256795C39",
  // MockToken — used as the alternate side for auction/OTC pairs where the
  // contract enforces token != paymentToken. Whitelisted on SettlementVault.
  MockToken: "0xEEAcA4dC06534E150Ee41e772BE675bCDF830150",
} satisfies Record<string, string>;

export type ContractName = keyof typeof CONTRACTS;

/** Token metadata */
export const TOKEN_CONFIG = {
  // On-chain: name() = "Zerith Test Dollar", symbol() = "CDEX", decimals() = 6
  // (ERC-7984 FHERC20 deployed October 2026). FAUCET_AMOUNT = 1000 * 1e6.
  name: "Zerith Test Dollar",
  symbol: "CDEX",
  decimals: 6,
  faucetAmount: "1000", // 1000 CDEX human-readable
} as const;

/** Wedge-focused primary navigation — the only items a foundation finance lead
 *  should see on first paint. Every other feature (Vickrey, Dutch, Batch, OTC,
 *  Payments, Trade, etc.) still lives at its URL and is reachable from /more.
 *  We do not delete features; we stop putting them in front of buyers who came
 *  here for one specific thing (encrypted block sales for token foundations). */
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard", group: "Overview" },
  { label: "Quickstart", href: "/quickstart", icon: "Sparkles", group: "Overview" },
  { label: "Block Sales", href: "/auctions", icon: "Gavel", group: "Product" },
  { label: "Treasury", href: "/treasury", icon: "Vault", group: "Product" },
  { label: "Payroll", href: "/payments", icon: "CreditCard", group: "Product" },
  { label: "Audit", href: "/audit", icon: "Shield", group: "Trust" },
  { label: "Docs", href: "/docs", icon: "Code2", group: "Trust" },
  { label: "Labs", href: "/more", icon: "Grid", group: "Trust" },
] as const;

/** Labs — listed on /more. Read-only or experimental surfaces that still work.
 *  Every other non-core route renders a "paused" page (see PausedFeature). */
export const SECONDARY_NAV = [
  { label: "Activity", href: "/activity", icon: "Activity", description: "A feed of on-chain events across Zerith. Shows counts and parties, never encrypted amounts." },
] as const;

/** Features paused until they're ported to Fhenix CoFHE 1.0 and escrowed settlement. */
export const PAUSED_FEATURES = [
  { label: "Vickrey auctions", href: "/vickrey" },
  { label: "Dutch auctions", href: "/dutch" },
  { label: "Batch auctions", href: "/batch" },
  { label: "Overflow sales", href: "/overflow" },
  { label: "OTC desk", href: "/otc" },
  { label: "Trading", href: "/trade" },
  { label: "Limit orders", href: "/limits" },
  { label: "Escrow", href: "/escrow" },
  { label: "Freelance bidding", href: "/freelance" },
  { label: "Payment streams", href: "/streaming" },
  { label: "Confidential multisig", href: "/multisig" },
  { label: "Organizations", href: "/org" },
  { label: "Vesting", href: "/vesting" },
  { label: "Royalties", href: "/royalty" },
  { label: "Referrals", href: "/referrals" },
  { label: "Reputation", href: "/reputation" },
  { label: "Raffles", href: "/raffle" },
  { label: "Token wrapper", href: "/wrapper" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Allowlist gate", href: "/allowlist" },
  { label: "Agent", href: "/agent" },
] as const;

/** Encryption stage labels for progress display.
 *  These mirror the the SDK's encryptInputs() pipeline: each label tells the user
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
