# Zerith — Encrypted Block Sales for Token Foundations

**Sell your treasury without leaking it.**

---

## The problem

When a foundation, DAO, or large holder sells a block of tokens, the market sees it coming. Order-book sales get front-run. OTC desks leak. Even "private" RFQs surface bidder identities the moment quotes hit. The result: foundations consistently sell at a discount, lose 1–5% to MEV and predatory market-makers, and tip strategic moves to competitors.

## The Zerith approach

Zerith runs sealed-bid block sales on-chain using Fhenix's fully homomorphic encryption (FHE). The contract computes the winner over **encrypted** bids — no node, validator, MEV searcher, or counter-bidder ever sees a losing bid. Winners are revealed only on settlement. Losers stay encrypted forever.

It's not a mixer. It's not zero-knowledge. The bids are computed on while still encrypted, then a tightly-scoped reveal exposes only what settlement requires.

## What it does, in 3 lines

1. **Foundation lists a block sale** — quantity public, reserve price encrypted.
2. **Buyers submit sealed bids** — quantities and prices encrypted on-chain.
3. **Contract reveals the clearing price + winners** — every loser's bid stays sealed forever.

## Proof — it works today on Ethereum Sepolia

| Run | What was proven | On-chain tx |
|---|---|---|
| Multi-bidder sealed reveal | 3 bidders @ 500 / 800 / 1200 → only 1200 revealed, the 500 + 800 bids remain encrypted on-chain forever | [`0x98a1c650…fafc7`](https://sepolia.etherscan.io/tx/0x98a1c650b8f992dacba8580ac25aa1c1960bde1d37fa490697a9a143014fafc7) |
| Cross-account decryption rejection | Burner #2 tries to decrypt Burner #1's bid → threshold network refuses | Logged in `LAUNCH-QA-RESULTS.md` |
| 26 contracts deployed, 34 verified Sepolia txs | Full system — auctions, payments, treasury, OTC, payroll, streaming, multisig, freelance, allowlist | [github.com/Ritik200238/zerith](https://github.com/Ritik200238/zerith#reviewer-replay-path) |

## Why this matters for token foundations

- **No price impact pre-trade.** The market literally cannot see your reserve or your bids until the auction clears.
- **No front-running surface.** There's nothing to mempool-watch. Bids are ciphertexts.
- **No MEV tax.** No public order to sandwich. No quote to fade.
- **Auditable when needed.** Public clearing price + public winner + public settlement. Sealed inputs.

A $50M block sale that historically loses 2% to slippage ≈ **$1M saved per sale**.

## Status

| Surface | State |
|---|---|
| Block sales contracts on Fhenix CoFHE | **Live on Ethereum Sepolia** |
| Reviewer-friendly README + 15 tx hashes | **github.com/Ritik200238/zerith** |
| Web UI with embedded burner wallet | **zerith-fi.vercel.app** (try in 30s, no MetaMask needed) |
| Mainnet (Arbitrum) | Q3 2026 target, post-audit |

## Who built it

Ritik — solo, 8 weeks. 26 smart contracts, 14+ distinct FHE operations, 40+ tests. Cofhejs + Hardhat + Next.js. Now talking to foundations who feel the leak on every treasury action.

## What I'm asking

20 minutes. Show you the live auction running on testnet. Ask 3 questions about how your foundation handles treasury sales today. If there's a fit, we explore a paid pilot.

**Contact:** [your-email] · [calendly link] · [github.com/Ritik200238/zerith](https://github.com/Ritik200238/zerith)
