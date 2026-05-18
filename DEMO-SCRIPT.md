# Zerith — Demo Script

> **Two demos in one doc:**
>
> 1. **60-second killer demo** — what a judge or first-time visitor needs to walk away with one moment they remember
> 2. **5-minute extended demo** — the full walkthrough across all hero surfaces, scripted click-by-click

Both demos run on the live Sepolia deployment (Chain ID 11155111). All contracts pre-seeded — see [LAUNCH-DAY-TEST.md](./LAUNCH-DAY-TEST.md) for the seed inventory.

---

## Pre-flight (do ONCE before recording or demoing)

1. **Browser:** Chrome/Brave with MetaMask on Ethereum Sepolia.
2. **Wallet:** funded with ~0.05 ETH for gas (Sepolia faucet via [sepoliafaucet.com](https://sepoliafaucet.com)).
3. **Frontend:** running locally (`cd cipherdex/frontend && npm run dev`) or use the deployed Vercel URL.
4. **Verify alive state:** `npm run launch-check` from `cipherdex/` should show every contract count ≥ 1.

If running cold, run `npm run seed-state` to top up. Takes ~90 seconds.

---

## DEMO A — 60-second killer demo (the moment they remember)

### Goal
Show that **bids stay sealed forever** in a way a judge can verify on Etherscan.

### Script

| Sec | Action | What to say | What they see |
|-----|---|---|---|
| 0:00 | Open `/auctions-suite` in a fresh browser tab | "Five sealed-bid auction mechanisms. One privacy backbone — Fhenix FHE." | 5 mechanism cards with live counts |
| 0:10 | Click "Open" under **Sealed** | "Let's place an encrypted bid." | Auctions page loads, seeded auction visible |
| 0:15 | Click **Connect Wallet** → MetaMask sign | (no commentary) | wallet connects, address shows top-right |
| 0:25 | Click the **Privacy Lens** in the navbar → switch to **Observer** | "First — this is what a public observer would see while bidders are bidding." | Privacy Lens row shows "🔒 sealed" for amounts |
| 0:35 | Click an auction card → **Place Bid** | "I'll bid encrypted." | Bid modal opens |
| 0:38 | Type any number (e.g., 42) → **Encrypt & Submit** | "Encrypted client-side via Fhenix's `@cofhe/sdk` (TFHE + ZK proof) before it ever touches the chain." | Encryption progress overlay → wallet sign → confirm |
| 0:50 | Open the tx on Sepolia Etherscan (link in toast) | "**The transaction is public. The amount is not.** That ciphertext on the input data — nobody can decrypt it, not even the contract itself, until reveal." | Etherscan shows the tx; input data is gibberish |
| 0:60 | Switch Privacy Lens to **Me** | "I can see my own bid via permit. Other bidders cannot. The contract uses FHE.max() on ciphertext to find the winner — without ever decrypting any losing bid." | (mic drop) |

### The line that lands
*"This isn't a private app on top of a public chain. The math itself is private. Losing bids never decrypt — ever. Not at reveal, not at settlement, not after."*

---

## DEMO B — 5-minute extended walkthrough

Full tour across the v1 surfaces. Each section: ~45 seconds.

### Setup (0:00 - 0:30)

1. Open `/` (landing) → read the tagline aloud
2. Click **Connect Wallet** → MetaMask sign
3. **OnboardingModal** auto-appears — click through (~20s):
   - Welcome → click Next
   - How FHE works → click Next
   - Connect (auto-skips because we're connected)
   - Faucet → click **Get test tokens** → MetaMask sign → 1000 CDEX minted
   - Path → click **Continue to Treasury** (primary CTA)

### Treasury (0:30 - 1:15)

Landing on `/treasury`:

1. Point out the encrypted balance card → **🔒 Sealed** state
2. Click **Unseal** → MetaMask permit prompt (if first time) → balance reveals (e.g., "1000 CDEX")
3. Say: *"Only I can see this. Everyone else — including the contract — sees only the ciphertext handle."*
4. Scroll to **Proof of Reserves** section → click **New proof**
5. Enter threshold = 500 → click **Request proof**
6. Wallet signs → tx confirms → toast: *"Claim pending Threshold Network reveal"*
7. *(Reveal step takes ~30-60s if you want to demo it. Otherwise show pre-seeded PoR claim and click Reveal via TN.)*

### Privacy Lens (1:15 - 1:45)

Still on `/treasury`, scroll to **Privacy Lens** section:

1. Open Privacy Lens dropdown in navbar
2. Click **Me** → rows show your balance, claims, etc.
3. Click **Counterparty** → rows pivot: "🔒 sealed (use Proof of Reserves to attest a threshold)"
4. Click **Observer** → rows show ciphertext handles and public addresses only
5. Say: *"Same page. Three perspectives. The math enforces what each role can see."*

### Encrypted Payroll (1:45 - 2:45)

Navigate to `/payments`:

1. Click **+ Create Split**
2. Add 3 rows: different addresses, different amounts (e.g., 100 / 200 / 300)
3. Say: *"Salaries are public on every other chain. Look:"*
4. Open the form preview → point at the rows
5. Click **Encrypt & Send** → encrypt overlay → wallet sign → confirm
6. Open the tx on Etherscan: 1 tx, no per-recipient amounts visible
7. Say: *"Total deposit (600 CDEX) is on-chain. Per-recipient split is mathematically inaccessible to anyone except each recipient via permit."*

### Sealed Auction with Blind Floor (2:45 - 3:45)

Navigate to `/auctions`:

1. Click **+ Create Auction**
2. Fill in: amount, duration = 5min, snipe = 60s
3. **Toggle: Blind Floor Auction** ON → enter encrypted reserve price (e.g., 50)
4. Say: *"The reserve is encrypted right now and it will **never** decrypt. Not at reveal. Not at settlement. Bidders cannot reverse-engineer the floor."*
5. Click **Create Blind Floor Auction** → encrypt + sign + confirm
6. The new auction card shows the **🔒 BLIND FLOOR** badge
7. *(If demo'ing reveal: pre-seeded auction near expiry → click Reveal → contract publishes only "Reserve MET" or "Reserve NOT MET" boolean via TN signature)*

### OTC Desk (3:45 - 4:30)

Navigate to `/otc`:

1. Show the **Privacy Lens · sample OTC request** block at the top
2. Toggle the lens to **Counterparty** → reveals "🔒 sealed (their quote settles iff in range, zero otherwise)"
3. Click **+ New request**
4. Fill: tokenWant = CDEX, tokenOffer = MOCK, encrypted amount + min/max prices, deadline
5. Encrypt + submit
6. (Optional, for fuller demo) Use a second wallet to submit a quote, then back to first wallet to **Choose quote** (the picker modal — fixes the "accept first quote" hardcoded bug from the audit)

### Activity Log (4:30 - 5:00)

Navigate to `/activity`:

1. Point out the chronological feed — your payment, your auction bid, your PoR claim
2. Filter chips (All / Sent / Received / Bids / Reserves) — click each to filter
3. Say: *"Every action you've taken — payments, bids, reserve proofs — in one timeline. Each row's amount stays sealed; only you can unseal your own."*

---

## Talking points by judge persona

**Privacy-savvy judge:**
> "Fhenix FHE means computation happens **on ciphertext**. We use FHE.gt, FHE.gte, FHE.max, FHE.select — bid comparison, range checking, winner selection — all on encrypted data. The Threshold Network verifiably decrypts ONLY the final outcome. Losing bids never decrypt, ever — and that's not a UX promise, it's a mathematical guarantee."

**DeFi judge:**
> "Five auction mechanisms in one suite — Sealed, Vickrey, Dutch, Batch, Overflow. Plus an OTC desk with encrypted price-range matching, plus encrypted payroll splits, plus a Proof of Reserves primitive nobody else has built on Fhenix. 27 contracts deployed on Eth Sepolia. End-to-end tested."

**UX-focused judge:**
> "Open the Privacy Lens dropdown in any page. Three modes: Me / Counterparty / Observer. Same data, three perspectives. That's what makes FHE legible to a non-technical user."

**Product judge:**
> "The wedge is encrypted payroll for crypto-native teams. Onchain treasurers right now broadcast every contractor payment to the world. Zerith makes salaries private without leaving the chain. Same trustless settlement, math-enforced privacy."

---

## What can go wrong (and how to recover)

| Symptom | Cause | Fix |
|---|---|---|
| **Faucet button doesn't appear** | Wallet not connected | Connect first; button still shows on disconnect now per the foundation agent fix |
| **Counts show 0 across the suite** | Sepolia state was reset or contracts moved | Run `npm run seed-state` (~90s) |
| **Reveal step takes >60s** | Threshold Network gateway latency | Wait. RevealAnimation is choreographed for this. Show the vault-open animation as a feature, not a bug. |
| **MetaMask asks for permit on every click** | First session — permit hasn't been signed yet | One-time 30-day super-permit signed on first unseal. Future actions are silent. |
| **Auctions show "0" after a redeploy** | New addresses landed; old auctions on previous contract | Run `npm run seed-state` to populate new addresses |
| **"Cannot read property X of undefined" in browser console** | Frontend addresses out of sync with deployment | `npm run copy-abis` in `/frontend`, restart `npm run dev` |

---

## Video recording recipe (≤90 second cut)

If you're recording a screen-cap demo for the buildathon submission:

1. **OBS or QuickTime** at 1080p, 30fps minimum
2. **Browser zoom 110%** so text is readable on YouTube
3. **Cursor highlighting** (zoom-on-click) — makes click sequences obvious
4. **Demo A script timed at 60s**, then 30s of voiceover on the talking points
5. **Open Etherscan in a 2nd window** so you can quickly cut to it after the bid submission
6. **Background music:** none (or barely audible). Let the silence after "losing bids never decrypt" carry the weight.

Upload to YouTube unlisted, paste link in submission. Done.

---

## Single-line pitch (for tweet, intro slide, etc.)

> *"Zerith is private finance for onchain teams — payroll, auctions, OTC, and proof of reserves where the math itself protects you. Built on Fhenix FHE: encrypted bids never decrypt, encrypted balances never leak, and counterparty trust is replaced with cryptography. Live on Eth Sepolia, 27 contracts deployed, 5 auction mechanisms, real Proof of Reserves on-chain."*
