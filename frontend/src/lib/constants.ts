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
  // MockToken — used as the alternate side for auction/OTC pairs where the
  // contract enforces token != paymentToken. Whitelisted on SettlementVault.
  MockToken: "0x949caC2113c0AF90b309Ec1A9136f7B159d1A672",
} satisfies Record<string, string>;

export type ContractName = keyof typeof CONTRACTS;

/** Token metadata */
export const TOKEN_CONFIG = {
  // Verified on-chain 2026-05-18 against ConfidentialToken at 0x5604…2a3d2:
  //   name()     = "CipherDEX Token" (on-chain, immutable from the original deploy)
  //   symbol()   = "CDEX"
  //   decimals() = 6
  // UI brand reads as "Zerith Token" for display purposes; the on-chain
  // symbol stays CDEX (immutable). The 18→6 decimals fix is critical:
  // FAUCET_AMOUNT = 1000 * 1e6 on the contract, so with the old decimals=18
  // every formatted amount across the app was off by 12 orders of magnitude.
  name: "Zerith Token",
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
  { label: "Audit", href: "/audit", icon: "Shield", group: "Trust" },
  { label: "Docs", href: "/docs", icon: "Code2", group: "Trust" },
  { label: "More", href: "/more", icon: "Grid", group: "Trust" },
] as const;

/** Secondary surface — everything reachable from /more. Order matters: most
 *  foundation-relevant variants of the wedge come first; tooling that's useful
 *  for DAOs/payroll comes second; experimental / phase-2 surfaces last. */
export const SECONDARY_NAV = [
  // Auction variants (same wedge, different mechanics)
  { label: "Vickrey", href: "/vickrey", icon: "Eye", description: "Sealed bids, highest wins, second-highest pays. Incentive-compatible." },
  { label: "Dutch", href: "/dutch", icon: "TrendingDown", description: "Price ticks down, first buyer at their target wins. Encrypted purchase amounts." },
  { label: "Batch", href: "/batch", icon: "Layers", description: "Many bidders, one clearing price, no front-running on order arrival." },
  { label: "Overflow", href: "/overflow", icon: "Droplets", description: "Oversubscribed token sales pro-rata, no whale sniping on cap." },
  // DAO finance primitives
  { label: "Payments", href: "/payments", icon: "CreditCard", description: "Encrypted payroll splits — each recipient only sees their own amount." },
  { label: "OTC", href: "/otc", icon: "Users", description: "Sealed request-for-quote. Counterparties never see your price band." },
  { label: "Trade", href: "/trade", icon: "ArrowLeftRight", description: "Limit orders with encrypted prices. No MEV on order arrival." },
  // Trust / observability surfaces
  { label: "Activity", href: "/activity", icon: "Activity", description: "Cross-feature activity feed with privacy indicators." },
  { label: "Reputation", href: "/reputation", icon: "Star", description: "Reputation scores on encrypted history." },
  { label: "Agent", href: "/agent", icon: "Sparkles", description: "Programmatic agent that runs encrypted workflows on your behalf." },
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
