# Known issues

Open issues we know about, why they exist, and what fixes them.
Last reviewed: 2026-10-12.

---

## 1. Not externally audited

**Status:** open · required before mainnet

The core contracts have a Hardhat suite that includes the attack scenarios from the
October 2026 internal review, and Sepolia end-to-end scripts that run against the real
Threshold Network. Neither replaces an external audit.

## 2. One owner key

**Status:** open · required before mainnet

`SettlementVault` (Ownable2Step) and `PlatformRegistry` are owned by the deployer
`0x82c16269FFd99C747D9437974E4d44C49187DCFF`. The owner can pause the platform, change
fees, and authorize which contracts may lock and release escrow. A malicious or
compromised owner could authorize a contract that releases escrowed funds.
**Fix:** transfer ownership to a multisig (Safe) before any mainnet deployment.

## 3. Escrow has no timeout if the Threshold Network is unavailable

**Status:** open · by design for now

Lot confirmation and reveals need a Threshold Network signature. If the network is down,
a sale can't confirm or reveal, and escrowed bids and the lot stay locked until it
returns. There is no on-chain timeout that refunds without a reveal. Pausing the
registry also pauses refunds.
**Possible fix:** a long emergency timeout that returns every escrowed amount without
revealing anything.

## 4. Demo gas faucet rate limits are per server instance

**Status:** mitigated · fix available

`/api/burner/create` only tops up an address with gas (the key is created in the
browser). It checks origin, skips addresses that already have gas, records limits only
after a successful top-up, caps top-ups per hour, and sizes the amount from live gas
prices. Without Upstash configured, those limits live in memory per serverless instance.
**Fix:** set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in Vercel (support is
built in).

## 5. Paused features

**Status:** open

About 20 features (Vickrey, Dutch, batch and overflow auctions, OTC, order book, limit
orders, escrow, freelance bidding, streaming, multisig, organizations, vesting,
royalties, referrals, reputation, raffles, token wrapper, portfolio, allowlist, agent)
are paused. Their contracts predate CoFHE 1.0's input format and several settle each
leg separately. Code: [`legacy-contracts/`](../legacy-contracts/). Each returns once
it's ported onto the vault's escrow.

## 6. Frontend builds with webpack, not Turbopack

**Status:** open · workaround in place

`frontend/vercel.json` pins `next build --webpack` because the SDK's WASM loading
needs the webpack `asyncWebAssembly` config in `next.config.ts`. Fonts are therefore
loaded with `<link>` tags rather than `next/font`. Worth re-testing with
`@cofhe/sdk` 0.8.

## 7. Building from a folder whose path contains `#`

**Status:** open · local only

Webpack truncates paths at `#`, so `next build` fails from a folder like
`Fhenix ritik #1`. Vercel builds are unaffected. Workaround: build from a path
without `#` (for example a mapped drive).

---

## Report a new issue

Security issues: a [GitHub security advisory](https://github.com/Ritik200238/zerith/security/advisories/new).
Everything else: a GitHub issue.
