# Zerith

**The private operating system for DAOs — launch tokens, pay teams, trade treasury, hire talent. All encrypted.**

Zerith is a private finance protocol built on Fhenix FHE (Fully Homomorphic Encryption). Every bid, payment amount, trade price, and reputation score is encrypted on-chain. The blockchain processes your finances without ever seeing the numbers.

[Launch App](https://cipher-dex.vercel.app) · [ConfidentialToken on Etherscan](https://sepolia.etherscan.io/address/0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2) · [Demo script](./DEMO-SCRIPT.md) · [Launch Day Test](./LAUNCH-DAY-TEST.md)

---

## The Problem

Every transaction on a public blockchain is a postcard:

- **DAOs** — contributor salaries visible to everyone. Politics. Resentment.
- **Token launches** — bots see first bid, front-run with larger bid. Retail loses.
- **Large trades** — whale orders move the market before execution. 2-5% slippage.
- **Freelance hiring** — competitors see each other's bids, undercut to race-to-bottom.

Financial privacy isn't a feature request. It's missing infrastructure.

## The Solution

Zerith encrypts every sensitive value using FHE before it hits the chain. Smart contracts compare, add, and settle encrypted values. The plaintext never exists on-chain.

```
You bid $5,000          →  Encrypted in your browser (TFHE + ZK proof)
Smart contract runs     →  FHE.gt(newBid, highestBid) — computes on ciphertext
Winner determined       →  FHE.decrypt(winningBid) — only result revealed
Losing bids             →  Stay encrypted. Forever. Nobody ever sees them.
```

No trusted intermediary. No hardware enclaves. No commit-reveal. Pure math.

---

## Features

### 5 Auction Types

| Type | Mechanism | Privacy |
|------|-----------|---------|
| **Sealed Bid** | Highest bid wins. Anti-snipe timer. | Bids + reserve price encrypted forever |
| **Vickrey (2nd Price)** | Highest wins, pays 2nd price. Truthful bidding. | Both highest and 2nd tracked on ciphertext |
| **Dutch** | Price decays over time. Buy at current price. | Purchase amounts encrypted |
| **Batch Clearing** | Uniform price where supply meets demand. | Order volumes counted on ciphertext |
| **Overflow / Fixed** | Fixed price. Oversubscribed = pro-rata allocation. | Individual deposits encrypted |

### Private Payments

Send money to multiple recipients where each person sees only their own amount.

- Encrypted per-recipient amounts — nobody sees what anyone else got
- Reusable templates for recurring payroll
- Single-step claim — amount never decrypted on-chain (end-to-end encrypted)
- Payment history tracking

### OTC Desk

Private venue for large trades. No slippage. No front-running.

- Encrypted RFQ with hidden price range bounds
- Multi-quote competition (quoters blind to each other)
- Atomic settlement via shared encrypted vault
- Zero market impact

### Freelance Bidding

Clients post jobs. Freelancers bid encrypted prices. Lowest bid wins.

- Blind bidding — no undercutting
- Milestone-based escrow release
- 3-voter encrypted dispute resolution (votes private, majority computed on ciphertext)
- 14-day auto-release timer (Upwork-style protection)

### Infrastructure

| Component | Purpose |
|-----------|---------|
| **FHERC20 Token** | Encrypted balances. Built-in faucet. |
| **Settlement Vault** | Shared encrypted balance ledger. All features settle through here. |
| **Token Vesting** | Cliff + linear unlock with encrypted amounts. On-chain enforcement. |
| **Merkle Allowlists** | Whitelist-gated launches. KYC, NFT-holder, VIP rounds. |
| **FHE Referrals** | Referrer earns % without identity linked on-chain. |
| **Claim NFT (ERC721)** | Tradeable positions. Winner sells claim before maturity. |
| **Encrypted Reputation** | Composable credit bureau API. Other contracts query without seeing scores. |

---

## What's Novel

### Blind Floor Auction (Zerith-specific)

In every other auction system, the seller's reserve price is eventually revealed (commit-reveal exposes it at the end; classical auctions announce it upfront). In Zerith's Blind Floor mode, the reserve is encrypted with FHE and **never decrypted — not at settlement, not after.** The contract checks `FHE.gte(highestBid, encReserve)` and publishes ONLY the boolean outcome via the Fhenix Threshold Network. Bidders cannot reverse-engineer the floor, so they must bid their true value. To our knowledge, no prior FHE auction implementation keeps the reserve permanently sealed even after reveal.

### Encrypted Dispute Resolution

When a freelance milestone is disputed, 3 community voters submit encrypted votes (1 = approve, 0 = reject). The contract computes `FHE.add(v1, v2, v3)` on ciphertext, then decrypts only the sum. If ≥ 2, freelancer wins. Individual votes stay encrypted forever — no peer pressure, no retaliation.

### Proof of Reserves (encrypted threshold)

A treasurer can publicly prove "I hold ≥ X tokens" without revealing the actual balance. `ProofOfReserves` reads the encrypted vault balance, computes `FHE.gte` against a plaintext threshold, and publishes only the boolean outcome via TN signature. Composes with the vault — same encrypted balance flows through auctions, payments, OTC.

### Cross-Feature Encrypted Flow

One vault. Multiple features. Zero plaintext touchpoints. Deposit once → bid on auction → win tokens → trade OTC → pay developer → generate Proof of Reserves — all on encrypted balances that never touch plaintext between features.

### Vickrey (2nd-price) sealed-bid

Not novel as a *mechanism on FHE* (prior implementations exist on Zama's devnet via ETHGlobal hackathon projects; Trustee 2019 implemented it on Ethereum via Intel SGX). What is novel here: Vickrey deployed live alongside 4 other auction mechanisms in one production-grade suite, on Ethereum Sepolia, with a verifiable Threshold Network reveal path.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                     Zerith Protocol                  │
│                                                         │
│  Core Infrastructure                                    │
│  ├── ConfidentialToken (FHERC20 + faucet)              │
│  ├── SettlementVault (encrypted balance ledger)         │
│  ├── PlatformRegistry (users, fees, pause)              │
│  ├── AuctionClaim (ERC721 tradeable positions)          │
│  ├── TokenVesting (cliff + linear, encrypted)           │
│  ├── AllowlistGate (Merkle whitelist)                   │
│  ├── Referrals (FHE-private earnings)                   │
│  └── Reputation (composable credit bureau)              │
│                                                         │
│  Token Launch (5 auction types)                         │
│  ├── SealedAuction (1st price + anti-snipe)            │
│  ├── VickreyAuction (2nd price)                         │
│  ├── DutchAuction (descending price)                    │
│  ├── BatchAuction (uniform clearing)                    │
│  └── OverflowSale (fixed price + pro-rata)             │
│                                                         │
│  Finance                                                │
│  ├── PrivatePayments (encrypted splits)                 │
│  ├── OTCBoard (whale trading)                           │
│  └── FreelanceBidding (blind bids + milestones)         │
│                                                         │
│  Trading                                                │
│  ├── OrderBook (P2P matching)                           │
│  ├── Escrow (encrypted term verification)               │
│  └── LimitOrderEngine (private triggers)                │
│                                                         │
│  Analytics                                              │
│  └── PortfolioTracker (encrypted valuation)             │
└────────────────────────────────────────────────────────┘
```

---

## Deployed Contracts

All contracts deployed and live on **Ethereum Sepolia (11155111)**. Authoritative source: [`deployed-addresses.json`](./deployed-addresses.json). Verify live state any time with `npm run launch-check`.

| Contract | Address | Etherscan |
|----------|---------|-----------|
| ConfidentialToken | `0xad1c…BA196a` | [View](https://sepolia.etherscan.io/address/0xad1c3aCAB5794a7dE857D85e4098934235BA196a) |
| PlatformRegistry | `0x5140…3dB2` | [View](https://sepolia.etherscan.io/address/0x5140Af056CbeDFbb1544d3769E6924f18E743dB2) |
| SettlementVault | `0x8070…C3f7` | [View](https://sepolia.etherscan.io/address/0x8070C011260FcA24C9cB48DfE75804494677C3f7) |
| AuctionClaim | `0x707a…bBA6` | [View](https://sepolia.etherscan.io/address/0x707aB4D6d18d985b59146BF9c2e1d8D565A0bBA6) |
| **SealedAuction** (Blind Floor) | `0x7BCD…e32c` | [View](https://sepolia.etherscan.io/address/0x7BCDd0eff87D447bD50C42aEAC8f0D4dcEeEe32c) |
| VickreyAuction | `0x68fB…3ABA` | [View](https://sepolia.etherscan.io/address/0x68fBEB96988e3314a16A7aaE09E9561435893ABA) |
| DutchAuction | `0xF688…61e7` | [View](https://sepolia.etherscan.io/address/0xF68858D52fFf0784F5EdE582952639c79B1161e7) |
| BatchAuction | `0xb936…1f95` | [View](https://sepolia.etherscan.io/address/0xb9364c0CF31915D0873F60750d7E667243Ce1f95) |
| OverflowSale | `0xd199…567f` | [View](https://sepolia.etherscan.io/address/0xd199fFCED0E4F417e32573D871770860e405567f) |
| PrivatePayments | `0x45a9…5678` | [View](https://sepolia.etherscan.io/address/0x45a963867CE03f64c09e45312a74f0B7ca425678) |
| **OTCBoard** (overflow guard) | `0xBf90…49eb` | [View](https://sepolia.etherscan.io/address/0xBf90003e63De9a042Bd4C13C5cd00548616349eb) |
| **ProofOfReserves** | `0x02F6…DB4F` | [View](https://sepolia.etherscan.io/address/0x02F6EEcA72cBA136562d7a30d4F4EFF15d1CDB4F) |
| FreelanceBidding | `0x2505…3B8C` | [View](https://sepolia.etherscan.io/address/0x2505450Fb9331cCaA626E9cA11423835C08b3B8C) |
| OrderBook | `0x2Ec7…0FB8` | [View](https://sepolia.etherscan.io/address/0x2Ec736dDe1F645bc65A01de198A09BdC3B510FB8) |
| Escrow | `0x9ec7…ad25` | [View](https://sepolia.etherscan.io/address/0x9ec7cEd2bFab218C3270027D385CeF26627Cad25) |
| LimitOrderEngine | `0xa4B3…2CD0` | [View](https://sepolia.etherscan.io/address/0xa4B36Ae83Df3B4947D4451b13BE4331A37Ca2CD0) |
| PortfolioTracker | `0xB16F…a8f1` | [View](https://sepolia.etherscan.io/address/0xB16Fc2b5246dD7d2542E46F14BDED1aA947fA8f1) |
| Reputation | `0x42ea…2161` | [View](https://sepolia.etherscan.io/address/0x42ea9650f9fFAbF39c86497c5C0154fa93002161) |
| TokenVesting | `0x6A95…1ea1` | [View](https://sepolia.etherscan.io/address/0x6A9500bFF2fc980F0Ad33a83b202EA061fEE1ea1) |
| AllowlistGate | `0x7214…7F91` | [View](https://sepolia.etherscan.io/address/0x7214B8219A83b248AaBfDf84b284DedB7e1D7F91) |
| Referrals | `0x4b6F…95fc` | [View](https://sepolia.etherscan.io/address/0x4b6F242e207104e34de4f6544D34f0A7780495fc) |
| Organization | `0x66E6…cEa7` | [View](https://sepolia.etherscan.io/address/0x66E6e2e0dC9E4d486c36C494c620B687e18FCeA7) |
| EncryptedStreaming | `0x2D1F…9998` | [View](https://sepolia.etherscan.io/address/0x2D1F98B56e1E5299EB6A7cCdf18C460Fa4a89998) |
| ConfidentialMultisig | `0xB71E…7277` | [View](https://sepolia.etherscan.io/address/0xB71E9c2d096597DB50003Fe85d755119A3617277) |
| EncryptedRoyalty | `0xc192…39cf6` | [View](https://sepolia.etherscan.io/address/0xc1926ae9A6BF2bbdADbcFA8Cf40ca0DCB9739cf6) |
| ConfidentialWrapper | `0x7Cb5…0Df42` | [View](https://sepolia.etherscan.io/address/0x7Cb515093392Af34cF14c654dbA666422420Df42) |
| EncryptedRaffle | `0xEADb…1Af1b1` | [View](https://sepolia.etherscan.io/address/0xEADb49571BCA5188d9AEe0DB7b7154eD118Af1b1) |
| MockToken (seed) | `0x949c…A672` | [View](https://sepolia.etherscan.io/address/0x949caC2113c0AF90b309Ec1A9136f7B159d1A672) |

---

## Security

| Layer | Approach |
|-------|----------|
| **Privacy** | `FHE.select()` over `require()` — a revert leaks 1 bit. Enough reverts reconstruct a balance. Zerith never reverts on encrypted conditions. |
| **Encryption** | Every encrypted input is ZK-verified and signed by the CoFHE threshold network |
| **Access Control** | 4-tier FHE permit system: `allowThis` → `allowSender` → `allow` → `allowTransient` |
| **Contracts** | ReentrancyGuard on all state-changing functions. AccessControl for role-based permissions. |
| **Zero-Replacement** | Insufficient balance = transfer 0, not revert. Constant-time execution. |
| **Anti-Snipe** | Late bids extend auction deadline. Prevents last-second MEV. |
| **Emergency** | 7-day timeout on stuck decryption. Funds always recoverable. |
| **Auto-Release** | 14-day silence on freelance milestones = auto-release to freelancer. |

## FHE Operations Used

22+ distinct operations across 20 contracts:

`asEuint8` `asEuint64` `asEuint128` `asEaddress` `asEbool` `gt` `gte` `lt` `lte` `eq` `max` `min` `and` `or` `select` `add` `sub` `mul` `div` `decrypt` `allowThis` `allow` `allowTransient`

Each operation serves a clear purpose in business logic. Not padding.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Chain** | Ethereum Sepolia (11155111) |
| **Contracts** | Solidity 0.8.25, `@fhenixprotocol/cofhe-contracts`, OpenZeppelin |
| **FHE** | Fhenix CoFHE SDK, TFHE WASM, threshold decryption |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS, Framer Motion |
| **Wallet** | ethers.js v6, MetaMask |
| **Testing** | Hardhat, Chai, CoFHE mock environment |
| **Deployment** | Vercel (frontend), Hardhat (contracts) |

---

## Getting Started

**Use the app:**

Visit [cipher-dex.vercel.app](https://cipher-dex.vercel.app), connect MetaMask on Sepolia, get test tokens from faucet, and start trading.

**Run locally:**

```bash
git clone https://github.com/Ritik200238/Zerith.git
cd Zerith

# Contracts
npm install
npx hardhat compile
npx hardhat test

# Frontend
cd frontend
npm install
npm run dev          # http://localhost:3000
```

**Deploy & operate:**

```bash
cp .env.example .env
# Add PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY

# Full deploy from scratch (destroys live state — only on fresh chain)
npm run deploy:sepolia

# Targeted single-contract redeploys (preserve other live contracts)
npm run deploy:por       # ProofOfReserves
npm run deploy:sealed    # SealedAuction (Blind Floor)
npm run deploy:otc       # OTCBoard (overflow guard)

# Operational scripts
npm run launch-check     # read-only live state verification (20 checks)
npm run seed-state       # populate Sepolia with 1 of each artifact (~$0.10 gas)

# After any contract redeploy
cd frontend && npm run copy-abis
```

See [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) for the 60-second killer demo + 5-minute extended walkthrough, and [LAUNCH-DAY-TEST.md](./LAUNCH-DAY-TEST.md) for the full launch-readiness audit.

---

## Testing

19 test files. 368 tests passing.

```bash
npx hardhat test
```

Covers: all auction types, private payments, freelance bidding with milestones + disputes, vesting, allowlists, referrals, settlement vault, reputation, token operations.

---

## License

MIT
