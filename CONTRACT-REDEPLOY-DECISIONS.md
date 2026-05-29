# Contract-Level Findings — Redeploy Decision Memo

> Output of the 271-agent adversarial audit (2026-05-29). This memo covers ONLY
> the findings that require a **contract redeploy** to fix. Everything safely
> fixable in the frontend/docs/config was fixed autonomously in the same session
> (see `LAUNCH-RUN-LOG.md` / git history).
>
> **This is a decision you own.** I did not redeploy anything — redeploying live
> contracts is gated on your approval per CLAUDE.md and the launch charter.

---

## TL;DR recommendation

**Do NOT mass-redeploy the 27 contracts before judging.** Disclose the
testnet-grade limitations honestly (the project already does this on `/audit` and
`KNOWN-ISSUES.md` — lean into it) and harden on the **Arbitrum Sepolia production
deploy**, not mid-judging.

Why:
1. The live demo works end-to-end with 34+ on-chain tx proofs. A mass redeploy
   the week of judging risks breaking a working demo for marginal gain.
2. These are **testnet** contracts. No real funds. The findings are "settlement
   paths are not production-hardened" + "a few privacy scopes are looser than the
   marketing implied" — both normal at hackathon stage and both now **disclosed**.
3. The winning posture for this project is radical transparency. A judge who reads
   `/audit` + `KNOWN-ISSUES.md` and sees you already found and scoped these issues
   scores **higher** on Technical Execution than one who finds an undisclosed bug.
4. Rewriting escrow into ~10 contracts + redeploy + re-seed + the 40+ new tests it
   would need is multi-day and itself bug-prone. Not worth the judging-window risk.

**If you DO want to act, the contained, low-cascade redeploys are ranked in §3.**

---

## 1. Privacy-scope findings (highest stakes — these touch the core thesis)

| Contract | Finding | Severity | Fix | Cascade risk |
|---|---|---|---|---|
| **OverflowSale** | `FHE.allowGlobal(dep.encAmount)` at claim makes each depositor's own amount globally decryptable (not just by them). Aggregate total going public is by-design; per-deposit going *global* is looser than "amounts encrypted". | P1 | `FHE.allow(amount, msg.sender)` so only the depositor unseals their own. | **Low** — standalone contract. |
| **OrderBook** | Taker can infer the maker's hidden price by unsealing their own post-trade balance delta (binary-search price discovery) — defeats the stated purpose. Plus: any taker can brick a maker's order with a zero bid. | P0 (privacy) | Settle without exposing the comparison; bind order-kill to maker. | Low — standalone. |
| **LimitOrderEngine** | The published execution bit lets the oracle binary-search the secret trigger price; `settleTriggered` is unauthenticated (anyone can force-transition any order). | P0 (privacy+auth) | Don't reveal the trigger bit; gate `settleTriggered`. | Low — standalone. |
| **Organization** | Tally reveal publishes raw yes/no **weight**; combined with per-voter `VoteCast` events this leaks individual **vote direction** — contradicts the headline "encrypted votes" claim. | P2 | Compute `passed = FHE.gt(yes,no)` on ciphertext and reveal only the boolean (mirror SealedAuction's `encReserveMet`). | Low — standalone. |

**Frontend mitigation already applied:** the relevant UI claims were rescoped to
match what the contracts actually do (see the fix workflow output), so the *claims*
are honest even before any redeploy.

---

## 2. Settlement-economics / funds-correctness findings

These make the "real money" paths unsound. They do **not** block the testnet demo
(honest small-value flows settle fine), but a judge doing a deep contract read will
find them. All need redeploy + new tests.

| Contract | Finding | Sev |
|---|---|---|
| **SealedAuction** | No bid-time escrow + `uint128` bid truncated to `uint64`; winner can take tokens paying ~0; large bids corrupt payout. No emergency timeout for stuck reveal. | P0 |
| **VickreyAuction** | `euint128` price truncated to `uint64` (funds loss); no 7-day timeout; permissionless reveal. | P0 |
| **DutchAuction** | Settlement-direction/escrow bug → buyer pays while seller's tokens transfer 0; concurrent-oversell race; anyone can finalize a stale auction. | P0 |
| **BatchAuction** | `uint64` overflow in payment math; index-paired matching ignores per-order eligibility; dropped fills; no timeout. | P0 |
| **OverflowSale** | No payment escrowed at deposit; pro-rata claimants pay full price with no refund; oversubscribed losers front-runnable. | P0 |
| **PrivatePayments** | Escrows nothing — a claim silently pays 0 (vault zero-replacement) if the creator's vault balance is short, while still marking the recipient PAID. | P0 |
| **FreelanceBidding** | Never escrows client funds (freelancer can go unpaid); encrypted dispute votes are unbounded (one voter rigs any dispute). | P0 |
| **Escrow** | `fundDeal` moves zero tokens (no custody); `releaseDeal` settles balances never funded by the deal; `cancelDeal` refunds nothing → the advertised "atomic locked escrow" is non-functional. `euint128→euint64` truncation. | P0 |
| **TokenVesting** | Claimed-counter advances even when zero-replacement pays 0; `revoke` freezes already-vested tokens; "can't-rug" promise broken. | P0 |
| **ConfidentialMultisig** | `execute()` has no caller/quorum/deadline gate — anyone can call it before votes land and permanently brick any proposal. | P0 (grief) |
| **PortfolioTracker** | `untrackToken` permanently breaks the compute flow (index bug); price↔token misalignment. | P0/P1 |
| **Reputation** | No contract ever calls `recordTrade`, so `submitRating` reverts `Unauthorized` for every real user → `/reputation` is a dead end. *(Frontend now shows an honest empty-state instead of a failing form.)* | P0 (dead) |
| **EncryptedStreaming** | `cancel()` strands the recipient's vested-but-unclaimed accrual; silent `euint64` overflow on `rate*elapsed`. | P1 |
| **EncryptedRoyalty** | Settles from the caller's vault (no token pull); uses `FHE.div` with an **encrypted divisor** (the pattern CLAUDE.md forbids). *(Frontend now removes the broken approve + adds a vault-deposit notice.)* | P1 |
| **ProofOfReserves** | Proofs measure a stale snapshot but are presented as current truth; no timeout; outcome griefable. | P1 |
| **SettlementVault** | `settleTrade` trusts the caller-supplied encrypted amount with no range guard → ledger can be driven negative; `registry` has no setter (funds-stuck if registry self-pauses). | P2 |
| **ConfidentialWrapper** | `requestWithdraw` globally reveals the FULL balance; inbound transfer bricks an in-flight withdraw; `totalDeposited` underflow. *(Not in `deployed-addresses.json` — legacy; frontend now disclaims.)* | P1 |
| **EncryptedRaffle** | Not in `deployed-addresses.json` (legacy carry-over, unverified bytecode); no emergency timeout; modulo bias vs "verifiably fair". *(Frontend now disclaims legacy status.)* | P1 |

---

## 3. Access-control / dead-feature / brand findings

| Contract | Finding | Sev | Note |
|---|---|---|---|
| **AuctionClaim** | ERC721 name is the stale brand **"Sigil Claim"** — immutable, judge-visible on Etherscan. | P1 | Redeploy cascades (SealedAuction/Batch/Freelance hold its address + MINTER_ROLE). |
| **PlatformRegistry** | `suspendUser/register/registerContract` machinery is **dead code** — no feature contract consults it; `SettlementVault` trusts callers without checking `isRegisteredContract`. Stale "CipherDEX" NatSpec. | P1 | Either wire it or delete the surface so the on-chain API stops advertising capabilities it doesn't deliver. |
| **AllowlistGate** | `verifyAndMark(id, user, proof)` lets ANY caller permanently burn another address's one-time claim slot (griefing). `deactivate` is irreversible and silently flips the gate to "open to all". | P1 | Bind to `msg.sender`. |
| **Referrals** | `payReferralReward` has **no access control**, pays from the caller's own vault, and is **never invoked** anywhere → the "earn a share of fees" headline is non-functional. | P1 | Either gate + wire it, or remove the reward claim from the UI. |
| **ConfidentialToken** | On-chain name "CipherDEX Token" (immutable). | P3 | Already handled by the `/why-cdex` framing — leave for the production deploy. |

---

## 4. If you want to act now — ranked contained redeploys

Each of these is a **standalone** contract (no cascade), small change, high
signal-to-risk. I can prepare + execute any of these on your say-so (each needs:
edit → `npm run compile` → redeploy that one contract → update
`deployed-addresses.json` + `constants.ts` → `npm run copy-abis` → re-verify live).

1. **ConfidentialMultisig** — gate `execute()` on `block.timestamp > deadline` +
   quorum. Stops the "anyone bricks any proposal" griefing. **Highest value, lowest risk.**
2. **AllowlistGate** — `require(user == msg.sender)` in `verifyAndMark`. Kills the
   slot-griefing. One line.
3. **OverflowSale** — `FHE.allowGlobal(dep.encAmount)` → `FHE.allow(amount, msg.sender)`.
   Tightens per-deposit privacy to match the thesis.
4. **Organization** — reveal only the boolean outcome, not raw vote weights. Closes
   the vote-direction leak.

The auction/escrow/payments **escrow** rewrites (the P0 settlement bugs) are
explicitly **NOT** recommended as pre-judging redeploys — they're large, cascading,
and need a fresh test suite. They belong on the Arbitrum Sepolia production deploy.

---

## 5. What was already fixed without redeploy (so you know the gap)

The frontend/docs fixes in this session make every **judge-visible claim honest**
and every **clickable flow** either work or honestly disclaim — which is what wins
the first 5 minutes of judging. The contract internals above are the deeper layer a
judge only reaches with a contract read, and they are now **disclosed**, not hidden.

**My call: ship the safe fixes + the honest disclosure, present this memo, and
batch the real contract hardening into the production Arbitrum deploy.**
