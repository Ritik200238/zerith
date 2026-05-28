# Cold email templates — Token Foundations

> Three variants. Pick by relationship coldness. All under 120 words. Subject lines tested for openability, not cleverness.

---

## Variant A — Cold, problem-led (default)

**Subject:** Selling $XYZ blocks without leaking the size

Hi {{first_name}},

Quick one — when {{foundation}} sells a treasury block, how do you handle pre-trade leakage? OTC desks shop the quote, RFQ systems surface bidder identity, and order-book sales get sandwiched. Foundations I've talked to lose 1–5% per block to it.

I built Zerith — sealed-bid block sales on-chain using FHE (Fhenix). Bidders submit encrypted quantities + prices, the contract picks the winner over ciphertext, and losing bids stay encrypted forever. Live on Sepolia today, 26 contracts, 34 verified txs. A $50M block at 2% slippage ≈ $1M saved.

20 minutes to walk you through the live auction? No deck — I'll show the on-chain proof.

— Ritik
github.com/Ritik200238/zerith · zerith-fi.vercel.app

---

## Variant B — Warm intro / referral

**Subject:** {{introducer}} suggested I reach out — encrypted treasury sales

Hi {{first_name}},

{{introducer}} mentioned {{foundation}} has been thinking about how to run treasury sales without telegraphing them to the market. That's exactly what I've been building.

Zerith runs sealed-bid block sales on Fhenix's FHE coprocessor. Bids and reserve prices stay encrypted on-chain; only the winner + clearing price are revealed at settlement. It's not a mixer — it's a way to compute over encrypted bids natively, on Ethereum.

Live and provable on Sepolia today: [headline tx](https://sepolia.etherscan.io/tx/0x98a1c650b8f992dacba8580ac25aa1c1960bde1d37fa490697a9a143014fafc7) shows 3 bidders, only the winner revealed, losers encrypted forever.

Worth 20 minutes? Happy to send the one-pager first.

— Ritik

---

## Variant C — Twitter / Telegram DM (≤ 60 words)

Hey {{handle}} — built a thing you might care about. **Encrypted block sales for foundation treasuries**, on-chain, using Fhenix FHE. Bids stay sealed forever; only the winner is revealed at settlement. Live on Sepolia, 26 contracts, [verifiable tx](https://sepolia.etherscan.io/tx/0x98a1c650b8f992dacba8580ac25aa1c1960bde1d37fa490697a9a143014fafc7). Worth 15 min? github.com/Ritik200238/zerith

---

## Targeting checklist (do this before sending)

- [ ] Foundation has done at least one publicly-known treasury sale or OTC in the last 12 months
- [ ] You can name the *specific* trade or trade type they're managing (no generic "treasury management")
- [ ] You've checked their last 3 governance forum posts for current priorities
- [ ] Recipient is BD / Treasury / Ops — NOT engineering, NOT comms

## Follow-up cadence

- Day 0: Variant A or B
- Day +4: Single-line bump — "Did this land okay?" + reattach one-pager
- Day +10: Final — "Closing the loop on this for now. If timing changes, I'll be at [contact]."
- No fourth email.

## What to send when they reply "interested"

1. One-pager PDF (`ONE-PAGER.md` → export to PDF)
2. Calendly link — single 30-min slot, no decision tree

## What to NOT do

- Don't lead with "FHE." Lead with the problem (leakage on treasury sales).
- Don't promise mainnet today. Sepolia is the honest answer.
- Don't mass-send. 5 hand-picked > 200 sprayed.
- Don't follow up more than twice. Foundations are slow, not rude.
