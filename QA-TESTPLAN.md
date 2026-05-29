# Zerith — QA Test Plan

**Target build:** `cipher-dex.vercel.app` (or local `npm run dev`)
**Network:** Ethereum Sepolia (chainId 11155111)
**Block explorer:** https://sepolia.etherscan.io
**Token under test:** CDEX (`0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2`)

This document is for the QA engineer. Goal: prove that every feature visible in the sidebar **actually does what the UI claims, on-chain, end-to-end**. Every test produces one of three outcomes: PASS (tx mined, UI updates), FAIL (tx reverts or UI desyncs), or BLOCKED (cannot test — write down why).

If you cannot complete a step, do not invent. Write `BLOCKED: <reason>` in the result column.

---

## 0. Setup (one-time, ~5 minutes)

### 0.1 Pick a test environment
| Option | Use when |
|---|---|
| **Live**: https://cipher-dex.vercel.app | Default. Tests the real deployed build. |
| **Local**: `cd cipherdex/frontend && npm run dev` → http://localhost:3000 | Only if live is down or you're testing an unmerged fix. |

### 0.2 Pick your wallet path
Test BOTH paths at least once. Most per-feature testing can use whichever is faster.

| Path | How | Why test it |
|---|---|---|
| **Burner ("Try Instantly")** | Land on home → click **Try it instantly — no wallet needed**. A burner is generated and auto-funded with Sepolia ETH from the deployer. | Zero-friction demo flow. This is what 90% of new users will hit. |
| **MetaMask / WalletConnect** | Click **Connect Wallet** top-right → pick wallet. Needs ~0.005 Sepolia ETH for gas (grab from https://sepoliafaucet.com if empty). | Proves the multi-wallet picker (Reown AppKit) works. |

### 0.3 Browser tabs you'll need open
1. The app
2. Sepolia Etherscan (to verify tx hashes)
3. This file (to log results)

That's it. No phone, no env vars, no CLI.

---

## 1. Smoke test (run first, ~5 minutes)

If any of these fail, **stop and report** — feature-level testing is meaningless until these work.

| # | Step | Pass criteria |
|---|---|---|
| S1 | Load home page (`/`) | Page renders. No console errors. Hero says "Sell your treasury without leaking it." |
| S2 | Click **Try it instantly** | Burner spins up in ≤8s, redirects to `/treasury`. Wallet pill top-right shows a `0x…` address. |
| S3 | On `/treasury` click **Faucet** | Toast: "Claimed 1000 CDEX". Balance updates from 0 → 1000. Tx visible on Etherscan. |
| S4 | Open every sidebar link (Dashboard / Block Sales / Treasury / Audit / More) | All 5 load without crashing. No "404" or "Application error". |
| S5 | Disconnect → click **Connect Wallet** | Reown wallet modal opens. MetaMask appears. (If you have a phone wallet, QR appears too.) |

**Smoke result:** ▢ PASS  ▢ FAIL — if FAIL, log which step.

---

## 2. Feature-by-feature happy paths

For each feature: **what the user sees**, **the steps**, **the expected on-chain outcome**, **the contract** that should receive the tx. Tester logs the tx hash and PASS/FAIL.

### 2.1 Treasury — `/treasury`
**What it does:** Lets a DAO deposit CDEX into a vault that hides balances on-chain. Withdraw produces a Proof-of-Reserves attestation.

| Step | Action | Expected |
|---|---|---|
| T1 | Click **Faucet** | +1000 CDEX in wallet. Tx on `ConfidentialToken`. |
| T2 | Type `100` in Deposit, click **Deposit** | Two txs: approve, then `SettlementVault.deposit`. Vault balance goes up; wallet goes down 100. |
| T3 | Type `25` in Withdraw, click **Withdraw** | Tx on `SettlementVault.withdraw`. Wallet up 25, vault down 25. |
| T4 | Click **Generate Proof of Reserves** | Tx on `ProofOfReserves`. Receipt with timestamp + attestation hash appears. |

Pass = all 4 txs land + UI balances match Etherscan event values.

---

### 2.2 Block Sales (Sealed Auction) — `/auctions`
**What it does:** Foundation lists a token block; bidders submit sealed bids; only the winner reveals; losing bids stay encrypted forever.

**Needs 2+ wallets to test multi-bidder properly.** Use the burner path twice in two incognito windows (each gets its own burner), OR one burner + one MetaMask.

| Step | Action | Expected |
|---|---|---|
| A1 | Wallet #1: click **Create Auction**, fill (lot size, duration ~5 min) | Tx on `SealedAuction.createAuction`. New auction card appears. |
| A2 | Wallet #1: bid `500` | Tx with encrypted bid handle. Bid count → 1. |
| A3 | Wallet #2: bid `800` | Tx accepted. Bid count → 2. Neither amount visible in the UI of the other wallet. |
| A4 | Wallet #1 (creator): click **Close & Reveal** after end time | Tx on `SealedAuction.revealWinner`. Winner address shown. |
| A5 | Loser opens auction detail | Their bid still shows as encrypted/sealed — NEVER as `800` or `500`. |

Pass = winner is correctly the higher bid + loser amounts never display in plaintext anywhere in UI or Etherscan event data.

---

### 2.3 Vickrey Auction — `/vickrey`
**What it does:** Highest bid wins, second-highest price is paid. Incentive-compatible.

| Step | Action | Expected |
|---|---|---|
| V1 | Create Vickrey auction | Tx on `VickreyAuction`. |
| V2 | Two wallets bid (say 600 and 900) | Both accepted. |
| V3 | Settle | Winner = 900 bidder, settlement price = 600. |

---

### 2.4 Dutch Auction — `/dutch`
**What it does:** Price ticks down over time. Bidder reveals **when** they want to buy, but **how much** is encrypted (Blind Floor).

| Step | Action | Expected |
|---|---|---|
| D1 | Create Dutch auction (start 1000, floor 100, duration 5 min) | Tx on `DutchAuction`. Live price decay visible in UI. |
| D2 | Wait until price reads ~500, click **Buy** with amount `50` | Tx accepted. Amount is encrypted; only price + timestamp public. |
| D3 | Check Etherscan trace | Event has price field but no plaintext amount. |

---

### 2.5 Batch Auction — `/batch`
**What it does:** Multiple bidders settle at one clearing price; arrival order irrelevant.

| Step | Action | Expected |
|---|---|---|
| B1 | Create batch with 3 wallets bidding different prices | All bids accepted, no failed txs. |
| B2 | Settle | All winners settle at SAME clearing price; losers refunded automatically (zero-replacement pattern, no revert). |

---

### 2.6 Overflow Sale — `/overflow`
**What it does:** Oversubscribed token sale; cap auto-prorates across bidders so whales can't snipe the cap.

| Step | Action | Expected |
|---|---|---|
| O1 | Create overflow sale, cap 1000 | Tx on `OverflowSale`. |
| O2 | 3 wallets each request 500 (total 1500, over cap) | All 3 accepted. |
| O3 | Settle | Each gets ~333 (pro-rata), not first-come-first-served. |

---

### 2.7 Encrypted Payments / Payroll — `/payments`
**What it does:** Pay multiple recipients in one tx; each recipient sees only their own amount.

| Step | Action | Expected |
|---|---|---|
| P1 | Create split with 3 addresses + amounts (50/100/150) | Tx on `PrivatePayments`. |
| P2 | Switch to recipient wallet #1, click **Claim** + **Reveal my amount** | Sees `50` only. |
| P3 | From wallet #1, try to reveal wallet #2's amount | Rejected by threshold network (`decryptForView` denied). UI shows error, not the value. |
| P4 | Wallet #2 + #3 claim their own | Each sees correct amount. |

Pass = (a) each recipient sees their own amount, (b) cross-account decrypt is rejected, (c) total of revealed amounts == original deposit on Etherscan.

---

### 2.8 OTC — `/otc`
**What it does:** Sealed request-for-quote between two parties. Counterparties never see each other's price band until match.

| Step | Action | Expected |
|---|---|---|
| OT1 | Wallet #1: post request (sell 100 CDEX, encrypted target price) | Tx on `OTCBoard`. |
| OT2 | Wallet #2: open request, submit quote | Tx accepted. |
| OT3 | Wallet #1: accept quote | Status → MATCHED. Both balances updated. |

---

### 2.9 Limit Order Trading — `/trade`
**What it does:** Limit orders with encrypted prices. No MEV bot can read them before fill.

| Step | Action | Expected |
|---|---|---|
| TR1 | Place limit order (encrypted price) | Tx on `LimitOrderEngine` / `OrderBook`. |
| TR2 | From wallet #2, place crossing order | Match settles. Both fills land on-chain. |

---

### 2.10 Freelance Bidding — `/freelance`
**What it does:** Post jobs; bidders submit sealed bids; lowest-bid logic runs **on ciphertext** (FHE.lt).

| Step | Action | Expected |
|---|---|---|
| FR1 | Post job with budget 500 | Tx on `FreelanceBidding`. |
| FR2 | 2 different wallets each bid (200 and 350) | Both txs accepted. |
| FR3 | Job owner reveals lowest | Lowest bidder (200) selected. Other bid never shown in plaintext. |

---

### 2.11 Escrow — `/escrow`
**What it does:** Milestone-based escrow on top of Freelance. Disputes resolved without revealing bid prices to arbitrator.

| Step | Action | Expected |
|---|---|---|
| E1 | Create escrow with milestones | Tx on `Escrow`. |
| E2 | Submit milestone, payer approves | Funds release. |
| E3 | Submit milestone, payer rejects → dispute | Dispute state opened. (Resolution flow may be admin-only — log as observed.) |

---

### 2.12 Streaming Payments — `/streaming`
**What it does:** Vesting/streaming with encrypted per-second rate.

| Step | Action | Expected |
|---|---|---|
| ST1 | Create stream to recipient (e.g., 1000 over 1h) | Tx on `EncryptedStreaming`. |
| ST2 | After 5 min, recipient clicks **Withdraw** | Tx pays out roughly 1/12th of total. UI shows correct claimable amount. |

---

### 2.13 Multisig — `/multisig`
**What it does:** Confidential multisig — signers approve but the proposed amount stays encrypted until execution.

| Step | Action | Expected |
|---|---|---|
| M1 | Create multisig with 2 signers, threshold 2 | Tx on `ConfidentialMultisig`. |
| M2 | Propose tx (encrypted amount) | Proposal listed. |
| M3 | Both signers approve | Tx executes. Balance moves correctly. |

---

### 2.14 Organization — `/org`
**What it does:** DAO/org wrapper that bundles treasury + payroll + reputation.

| Step | Action | Expected |
|---|---|---|
| OR1 | Create org | Tx on `Organization`. |
| OR2 | Add member, set role | Tx accepted. Member shows in UI. |
| OR3 | Org-scoped action (e.g., fund payroll from org treasury) | Works end-to-end without manual address paste. |

---

### 2.15 Allowlist Gate — `/allowlist`
**What it does:** Gate a sale/feature behind an allowlist with encrypted entry.

| Step | Action | Expected |
|---|---|---|
| AL1 | Create allowlist, add wallet #1 only | Tx on `AllowlistGate`. |
| AL2 | Wallet #1 enters gated flow | Allowed. |
| AL3 | Wallet #2 (not on list) tries | Blocked at UI level + tx reverts if attempted. |

---

### 2.16 Vesting — `/vesting`
**What it does:** Token vesting schedules. Note: vesting positions are typically created by *contracts* (auction settlement), not directly by users.

| Step | Action | Expected |
|---|---|---|
| VE1 | Open page when no vesting position exists | UI shows clear empty-state message ("vesting positions are created by auction settlement"). NOT a broken/blank screen. |
| VE2 | After winning a settled auction, return here | Position appears with cliff/cliff date/claim button. |

---

### 2.17 Reputation — `/reputation`
**What it does:** Encrypted reputation derived from prior activity.

| Step | Action | Expected |
|---|---|---|
| RP1 | Open page with a fresh burner | Reputation = 0 / "new account". |
| RP2 | Complete a few features (bid, claim, accept OTC) | Reputation increments. Tx on `Reputation` for each contributing action. |

---

### 2.18 Royalty — `/royalty`
| Step | Action | Expected |
|---|---|---|
| RY1 | Create royalty schedule | Tx on `EncryptedRoyalty`. |
| RY2 | Trigger payout | Recipients get their share. |

---

### 2.19 Wrapper — `/wrapper`
**What it does:** Wraps a public ERC20 into a confidential version, or vice-versa.

| Step | Action | Expected |
|---|---|---|
| W1 | Wrap N CDEX | Approve + wrap txs. Confidential balance increases. |
| W2 | Unwrap | Public balance restored. |

---

### 2.20 Portfolio — `/portfolio`
**What it does:** Read-only roll-up of the user's encrypted positions across features.

| Step | Action | Expected |
|---|---|---|
| PF1 | After doing T1–T3, A1–A2, P2 above, open `/portfolio` | All positions show up. No "loading…" stuck forever. Reveal buttons work per-row. |

---

### 2.21 Activity — `/activity`
**What it does:** Cross-feature event feed with privacy indicators (counts visible, amounts encrypted).

| Step | Action | Expected |
|---|---|---|
| AC1 | Open after several txs | Feed lists actions. Encrypted fields show as ⛨ or "encrypted", NEVER plaintext. |

---

### 2.22 Audit — `/audit`
**What it does:** Public verification surface — contract addresses, ABI, Etherscan links.

| Step | Action | Expected |
|---|---|---|
| AU1 | Open page | All 26 contract addresses link to Etherscan. Each link opens correct contract. |

---

### 2.23 Raffle — `/raffle` (FLAGGED — known to use legacy addresses)
| Step | Action | Expected |
|---|---|---|
| R1 | Open page | If it loads + shows clear "test only" notice → OK. If it crashes or tries to write to a stale address → log as KNOWN ISSUE. |

---

### 2.24 Agent / Limits / Referrals / Auctions-Suite / More
For each: open the page, confirm it loads, confirm any primary CTA works end-to-end. Log behavior per feature.

---

## 3. Wallet matrix

Run smoke test S1–S5 **and** at least one Treasury deposit (test 2.1 T1+T2) through each wallet path.

| Wallet | Path | Result |
|---|---|---|
| Burner (Try Instantly) | Home → "Try it instantly" | |
| MetaMask (extension) | Connect → MetaMask | |
| Coinbase Wallet (extension) | Connect → Coinbase | |
| WalletConnect (Rainbow/Trust/Phantom EVM via QR) | Connect → "All Wallets" → scan QR with phone | |
| Disconnect + reconnect | Hit disconnect, then reconnect with a different wallet | Session swap clean, balance updates to new wallet's. |

**Network swap:** while connected on a non-Sepolia network (e.g., Mainnet), confirm the UI shows a "wrong network" banner with a one-click "Switch to Sepolia" button. Click it. Should succeed.

---

## 4. UI/UX checks (per page)

For every page tested above, also tick:

- ▢ No layout breakage at 1280px, 1440px, and 375px (mobile).
- ▢ No invisible dark-icon-on-dark or light-on-light.
- ▢ No "TODO", "FIXME", "Lorem ipsum", or placeholder text visible.
- ▢ Loading states exist for slow txs (spinner / skeleton). Page never looks frozen.
- ▢ Error states are human-readable. No raw `0x` hex error or stack traces shown to user.
- ▢ Faucet button reachable on every product page (top-right or hero).
- ▢ Toasts auto-dismiss after a few seconds.

---

## 5. Cross-feature regression (run last, ~15 minutes)

After all per-feature tests pass, run **one combined flow** to prove features compose:

1. Create burner → faucet 1000 CDEX
2. Deposit 500 into Treasury
3. Withdraw 100
4. Use 100 to bid in a Sealed Auction
5. Lose the auction (or get refunded) — confirm encrypted bid stays encrypted
6. Set up a 3-recipient Payment split (50/100/150) — claim from one recipient
7. Open `/portfolio` — confirm all positions roll up correctly
8. Open `/activity` — confirm a complete event history with privacy indicators

If this combined flow passes without console errors, refresh-loops, or stuck pending txs, the build is **launch-ready for that wallet path**.

---

## 6. Bug report template

For every FAIL, log in this exact format. Don't paraphrase.

```
ID: BUG-001
Page: /payments
Wallet: burner
Steps to reproduce:
  1. Faucet 1000 CDEX
  2. Create split: 0xABC=50, 0xDEF=100
  3. Click Create
Expected: tx submitted, split row appears
Actual: button shows "Submitting..." indefinitely. No tx in MetaMask.
Console error: <paste verbatim>
Network tab: <last failing call>
Tx hash (if any): <none / 0x…>
Screenshot: <attach>
Severity: P0 (blocks core flow) / P1 (workaround exists) / P2 (cosmetic)
```

---

## 7. Definition of "launch-ready"

The build passes when **all** of the following are true:

1. Smoke test (Section 1): PASS.
2. Sections 2.1–2.10 (the 10 core financial features): PASS or have a documented P1/P2 known-issue with a workaround.
3. Section 2.11–2.20 (extended features): PASS or have a clearly-labeled empty-state.
4. Wallet matrix (Section 3): at least Burner + MetaMask + one WalletConnect path PASS.
5. Cross-feature regression (Section 5): PASS.
6. Zero P0 bugs open.

Anything less = not launch-ready. Don't ship.

---

## Appendix A — Contract → page map (for the tester to know what to look for on Etherscan)

| Page | Contract | Address |
|---|---|---|
| /treasury | SettlementVault | `0x31B751027Ed82b489f42212371d17e30c4D655a5` |
| /treasury (PoR) | ProofOfReserves | `0xFA609253c0CA0297e8c272543EE806CAC203bd70` |
| /treasury (faucet) | ConfidentialToken | `0x56047782ABFE56d88f1f29b12b3c0C22ee12a3d2` |
| /auctions | SealedAuction | `0xdEe59FD1d8Ac071146c7ED012a0a343FdD56b0A0` |
| /vickrey | VickreyAuction | `0x12973Ac885A11136A9f948beCc6e810CF9D54e17` |
| /dutch | DutchAuction | `0xd9bA4b7b825f3558757Fe977d024b29e27B65b54` |
| /batch | BatchAuction | `0xB29AF471E9392D0bAafc898795d7Ed6Bd6fBEfd5` |
| /overflow | OverflowSale | `0x91b869Ba4Ad80683be67e7F2f776fFf655034Adb` |
| /payments | PrivatePayments | `0x15309001612f1667C2Fc1De2107769F438712b4B` |
| /otc | OTCBoard | `0x808C27D12265234bE405Eb45800f2BDB1f4Cdb3D` |
| /trade | OrderBook / LimitOrderEngine | `0x80b09409f2dB5FAEb45f2ca36C8C1b06772D45E2` / `0x09A01EFA1e97c9f12F1Aa6Dc0dAf1b019a58F8E6` |
| /freelance | FreelanceBidding | `0xf71715fD9c9d314D56FBa0031EBc69ba22d5CE05` |
| /escrow | Escrow | `0x36dbcCAF465f106ebB3da7E9776b0598d4f36d32` |
| /streaming | EncryptedStreaming | `0xa3076EF9395E2D7F81d9FB79Cd3E984449F938De` |
| /multisig | ConfidentialMultisig | `0x7250146635a9E0b60471037D6C7c51b21be28d36` |
| /org | Organization | `0x088356c0ab2035605422f8B4Da2d4037487EC1DF` |
| /allowlist | AllowlistGate | `0xa9d8DA5D2878E8261A1f9c2c53dCA21e849c0EE4` |
| /vesting | TokenVesting | `0x1be9DF85c8cd48b98f7F0Cc75F565225f00E4895` |
| /reputation | Reputation | `0xcbD4c5269219f3eE8a1C3Dbe0FB24d1F6558Ac09` |
| /royalty | EncryptedRoyalty | `0xD3AD70382cEcFdF291c060eE1fA17aE4Eb2DbF32` |
| /referrals | Referrals | `0x77ef973642CC1BAE0756D20E25c83d5b5148af13` |
| /portfolio (rollup) | PortfolioTracker | `0xe72F751B9FB60C542e352F82826f465FD3bc47a0` |

Full list: `cipherdex/deployed-addresses.json`.

---

## Appendix B — Known issues at time of writing

These are pre-existing, do NOT log as new bugs:

- `/raffle` — uses legacy address from prior contract set. Treat as informational.
- `/vesting` — positions are created by auction settlement, not by users directly. Empty state on a fresh burner is expected.
- Blind Floor Auction UI walkthrough — contract path exists, no dedicated UI yet. Tested indirectly via `/dutch`.

---

**Tester sign-off:** _________________________  Date: __________

**Build commit:** _________________________  (paste from footer or `git rev-parse HEAD`)

**Result:** ▢ LAUNCH-READY  ▢ NOT READY (attach bug list)
