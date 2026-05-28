# Known Issues

> Public log of issues we are aware of, why they exist, and how we are
> resolving them. We list these in the open instead of pretending they
> don't exist — same posture as `LAUNCH-QA-RESULTS.md` and `/audit`.

Last reviewed: 2026-05-28

---

## 1. Frontend builds with `--webpack` instead of Turbopack

**Status:** open · workaround in place · upstream-blocked

**What you see**

`cipherdex/frontend/vercel.json` pins:

```json
{ "buildCommand": "next build --webpack" }
```

Next.js 16 prefers Turbopack as the default bundler. Our pin opts out.

**Why**

Two upstream constraints:

1. **`cofhejs` / `@cofhe/sdk` WASM loading.** Both packages ship a
   WebAssembly module for client-side encryption. Turbopack's
   `experiments.asyncWebAssembly` interaction with these packages
   crashes at build time on certain code paths. The webpack config in
   `next.config.ts` (`asyncWebAssembly: true`, `layers: true`, plus
   the `fs/net/tls/crypto` fallbacks) is the workaround.
2. **`next/font/google`.** Turbopack uses the SWC font loader; webpack
   does not. Because we are pinned to webpack, fonts are loaded via
   `<link>` tags in `app/layout.tsx`. This is functional but means we
   cannot use the size-optimized `next/font` flow.

**Resolution plan**

- Track upstream Turbopack support in:
  - `cofhejs` — Fhenix's browser SDK. Our migration pre-req is
    confirmation that the WASM module loads under Turbopack with no
    regressions. We will open / link to the GitHub issue here when it
    exists.
  - `@cofhe/sdk` — same.
- Once the SDK side ships a Turbopack-clean release, the migration is:
  1. Remove the `--webpack` pin from `vercel.json`
  2. Re-enable `next/font/google` in `app/layout.tsx` and delete the
     manual `<link>` font preload
  3. Verify the encrypted bid + decryption flows on a preview deploy
  4. Roll the `next.config.ts` webpack overrides into Turbopack
     equivalents only where needed
- Until then: stay on webpack. Webpack support in Next.js is a stable
  long-tail option, and our build is reliable.

**Buyer impact**

None at runtime. Buyers see a fully built site. The constraint is a
build-time choice that doesn't affect users.

---

## 2. Pre-decimals-fix Freelance jobs are filtered out of the UI

**Status:** mitigated · server-side cleanup pending

**What you see**

On the live `/freelance` page, jobs whose `escrowAmount` exceeds
`1e15` smallest-units are skipped during fetch. These are residue
from before the `TOKEN_CONFIG.decimals` fix (18 → 6) — their values
are 10^12 too large to render correctly.

**Resolution plan**

Either:

- Redeploy `FreelanceBidding` to a fresh address and update
  `cipherdex/deployed-addresses.json` and
  `cipherdex/frontend/src/lib/constants.ts`, OR
- Add a `cancelJob(jobId)` admin path that lets the deployer mark the
  legacy jobs `CANCELLED` on-chain so the filter can be removed.

Tracked separately from this doc.

---

## 3. Two FHE providers running in parallel

**Status:** open · technical debt · migration in progress

**What you see**

Both `CofheProvider` (legacy `cofhejs@0.3.1`) and `Cofhe2Provider`
(new `@cofhe/sdk@0.5+`) are mounted in `frontend/src/components/layout/Providers.tsx`.

**Why**

Pages built before `@cofhe/sdk` shipped use the legacy client. Pages
that use the verifiable-reveal path (`useDecryptForTx`) need the new
SDK. The two clients don't share a connection, so we can't drop
either yet.

**Resolution plan**

Migrate page-by-page off `cofhejs` onto `@cofhe/sdk`. Tracked in a
checklist (to be added) under `frontend/src/MIGRATION.md`.

---

## 4. In-memory burner-funder rate limit

**Status:** open · production mitigation planned

**What you see**

`/api/burner/create` rate-limits per IP via an in-memory `Map<string, number>`.
Vercel Fluid Compute reuses function instances across requests, so this
is best-effort but not durable.

**Resolution plan**

Swap to Upstash Redis (free tier) before any traffic spike from
launch outreach. Code change is ~30 lines isolated to that route.

**Why this is OK for now**

The burner-funder wallet only holds a small Sepolia ETH budget, and
the per-IP window plus the small fund amount (0.008 ETH) bound the
worst case to negligible testnet ETH loss.

---

## 5. Single-deployer ownership of all 26 contracts

**Status:** open · acknowledged in README

**What you see**

Every `Ownable2Step` contract on Sepolia is owned by the deployer
EOA. Not a Safe multisig.

**Resolution plan**

Pre-mainnet move to a 2-of-3 Safe. Tracked in the launch sequence
in the comprehensive readiness review.

---

## How to report a new issue

Open a GitHub issue at <https://github.com/Ritik200238/zerith/issues>.
Tag with `bug`, `security` (private disclosure), or `feature`.
