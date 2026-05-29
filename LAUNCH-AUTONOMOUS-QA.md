# Zerith — Autonomous Launch-Ready Run

This is the authoritative mission spec for an autonomous end-to-end QA + fix-it run. The agent (Claude) executes this against the **live Vercel deployment** (`cipher-dex.vercel.app`) using **real burner wallets on Sepolia**, drives every UI flow via **Playwright MCP**, and **does not stop** until every exit criterion in Section 6 is GREEN.

> **One operating principle for this entire run:** Functionality > professionalism > polish. No half-baked. No "good enough." Either every flow works end-to-end with on-chain proof, or the run is not done.

---

## 1. Authority granted to the agent

The agent **may do all of the following without asking the user**:

- Generate additional burner wallets (script: `tasks/create-burner.ts`) and fund them from `BURNER_FUNDER_PRIVATE_KEY` in `cipherdex/.env`.
- Total burner spend budget: **up to 0.05 Sepolia ETH** across the run. Stop and report if approaching this.
- Drive the live site via Playwright MCP (navigate, click, type, screenshot, read console, capture network traffic).
- Read Etherscan via WebFetch to verify tx hashes, event logs, and ciphertext non-leakage.
- Edit any frontend file under `cipherdex/frontend/src/**` to fix a bug found in testing.
- Edit any contract test under `cipherdex/test/**` if a fix needs a regression test.
- Run `npm run typecheck`, `npm run build`, `npm run test`, `npm run copy-abis` as needed.
- Commit fixes with clean messages and push to `main` to trigger Vercel preview/production deploy.
- Update `cipherdex/LAUNCH-RUN-LOG.md` (created on first run) with progress, tx hashes, screenshots, fixes.
- Append new bugs + fixes to `cipherdex/LAUNCH-QA-RESULTS.md`.
- Recompile + redeploy contracts **only if** a fix is contract-side AND the user is asked first via AskUserQuestion.

The agent **must ask the user before**:

- Touching any value in `.env` (rotating keys, changing RPC URLs).
- Redeploying any smart contract or changing addresses in `deployed-addresses.json`.
- Anything affecting public infra (`zerith.fi` domain, Vercel project settings, Reown project config).
- Touching anything outside `C:\Users\ritik\Downloads\Fhenix ritik #1\`. The Aleo project at `C:\Users\ritik\Downloads\aleo ritik #1` is strictly off-limits.
- Force-pushing, skipping hooks (`--no-verify`), or any destructive git op.

---

## 2. Prerequisites the agent verifies FIRST (Phase 0)

Before any test runs, confirm:

- [ ] `claude mcp list` shows `playwright` is connected. If not, instruct user to run `claude mcp add playwright npx @playwright/mcp@latest` and restart the session.
- [ ] Live site at `https://cipher-dex.vercel.app` returns 200.
- [ ] `cipherdex/.env` exists and contains `BURNER_FUNDER_PRIVATE_KEY`.
- [ ] Funder wallet has ≥ 0.05 Sepolia ETH (check via WebFetch to Etherscan).
- [ ] `NEXT_PUBLIC_REOWN_PROJECT_ID` is set in Vercel env (check by loading site and confirming no console warning about missing project ID). If missing, the agent flags it but continues — MetaMask path still works via EIP-6963.

If any prereq fails, the agent **stops, reports the blocker, and asks the user to resolve**. Otherwise proceeds to Phase 1.

---

## 3. Test matrix — what gets verified

Source of truth for happy paths: **`cipherdex/QA-TESTPLAN.md`**. This run executes every section of that plan against the live site, with the agent acting as the QA engineer.

### Phase 1 — Smoke (~10 min)
- Land on `/`, screenshot hero.
- "Try Instantly" → burner spins up → redirects to `/treasury`.
- Click every sidebar link (Dashboard, Block Sales, Treasury, Audit, More). Capture screenshot of each. Confirm zero console errors.
- Open `/more` → click every secondary item. Confirm each renders.

### Phase 2 — Feature happy paths (~2 hours)
For each page in `QA-TESTPLAN.md` Sections 2.1–2.24:
1. Burner wallet drives the primary flow.
2. Where the flow needs ≥2 wallets (Sealed Auction, Vickrey, Batch, Overflow, OTC, Multisig, Payments multi-recipient), spawn additional burners via `tasks/create-burner.ts`.
3. Capture: tx hash on Etherscan, screenshot of final UI state, console log if any error.
4. Log result row to `LAUNCH-RUN-LOG.md` as `PASS | FAIL | BLOCKED` with evidence.

### Phase 3 — Multi-wallet matrix (~30 min)
- Burner-only path: covered in Phase 2.
- WalletConnect modal: open from Connect button, confirm modal renders, confirm at minimum MetaMask + WalletConnect QR + Coinbase tiles visible. Screenshot.
- Network-mismatch banner: simulate via Playwright by spoofing `window.ethereum.chainId` to mainnet; confirm "Switch to Sepolia" banner appears + click works.
- Disconnect → reconnect (different burner): confirm `sigil-account-changed` event fires (no stale balance from prior burner).

### Phase 4 — Privacy verification (~30 min)
**This is the marketing-claim test. Cannot skip.**
- Pick the Sealed Auction multi-bidder run from Phase 2 (winning bid + 2 losing bids).
- WebFetch Etherscan event log for the auction contract for that tx range.
- For each losing bid: confirm the raw event data is a ciphertext handle, NOT a plaintext amount. Grep for the literal loser amounts (e.g. `500`, `800` if those were used) in event hex — must be absent.
- Repeat for Payments: confirm each recipient amount in the deposit event is encrypted; only the per-recipient `decryptForView` returns plaintext **and only to that recipient**.
- Log raw event hex + analysis in `LAUNCH-RUN-LOG.md`.

### Phase 5 — UI/UX sweep (~45 min)
- Resize browser to 1440px / 1280px / 768px / 375px on every product page. Screenshot. No overflow, no broken layouts.
- Scan every page for: invisible dark-icon-on-dark, light-icon-on-light, placeholder text ("TODO", "Lorem ipsum", "FIXME"), missing loading states (no spinner during a 5-sec tx), raw hex error messages exposed to user.
- Confirm Faucet button reachable from every product page.
- Confirm toast notifications auto-dismiss.

### Phase 6 — Cross-feature regression (~20 min)
Execute the single combined flow from `QA-TESTPLAN.md` Section 5 (faucet → deposit → withdraw → bid → lose → encrypted refund → payroll split → portfolio rollup → activity feed). Must complete with zero stuck txs.

---

## 4. Bug-fix loop

For every issue found during Phases 1–6:

1. **Classify severity:**
   - **P0** — blocks a core flow (faucet broken, can't bid, can't claim, app crashes). Must fix before continuing.
   - **P1** — degrades a core flow but workaround exists (wrong amount displayed, slow tx, broken responsive layout on one breakpoint).
   - **P2** — cosmetic (icon color off, copy typo, hover state missing).

2. **Fix policy:**
   - **P0**: Stop the test pass. Fix immediately. Re-run the affected test. Do not move on with P0 open.
   - **P1**: Fix in-place if root cause is obvious AND under 30 min. Otherwise log and continue, batch the fixes at end of phase.
   - **P2**: Log only. Batch-fix in a single commit at the very end.

3. **Fix procedure:**
   - Reproduce locally if possible (or via Playwright on live).
   - Edit the file.
   - Run `npm run typecheck` — must pass clean.
   - If the change is non-trivial, run `npm run build` locally to confirm.
   - Commit with a tight message (`fix(payments): cross-account decrypt rejected silently — surface error toast`).
   - Push to `main` → Vercel auto-deploys.
   - Wait for Vercel deploy ready (poll via WebFetch on the deployment URL or check status code on production).
   - Re-run the failing test. Log PASS only after re-verify.

4. **Never:**
   - Skip a test because a fix is "too hard." Either fix it or write `BLOCKED: <specific reason>` and escalate to user.
   - Mark something PASS without a tx hash or screenshot.
   - Use `--no-verify` to bypass hooks.
   - Rewrite a contract without explicit user approval.

---

## 5. Evidence format

All evidence lives in `cipherdex/LAUNCH-RUN-LOG.md`, structured as:

```
## Phase 2.7 — Encrypted Payments (PrivatePayments)
Result: PASS
Evidence:
  - Create split (50/100/150): 0xabc123... → https://sepolia.etherscan.io/tx/0xabc123...
  - Burner1 claim+reveal (50): 0xdef456...  Screenshot: screenshots/payments-burner1-claim.png
  - Burner1 try to decrypt burner2 share: REJECTED ✓  Screenshot: screenshots/payments-cross-decrypt-rejected.png
  - Burner2 claim+reveal (100): 0x789abc...
  - Burner3 claim+reveal (150): 0xfedcba...
Notes: payroll-recipient hover state was invisible on dark mode → fixed in commit 0xdeadbeef
```

Screenshots go in `cipherdex/launch-evidence/screenshots/`. Use descriptive kebab-case filenames.

---

## 6. Exit criteria — Definition of "launch-ready, claim-able"

The run is COMPLETE only when **every one** of these is GREEN:

1. **All 24 feature pages** from `QA-TESTPLAN.md` Section 2 have a PASS row in `LAUNCH-RUN-LOG.md` with at least one tx hash on Etherscan. Acceptable exceptions: `/raffle` (legacy carry-over, documented), `/vesting` empty state (positions created by auction settlement, documented).
2. **Multi-wallet matrix** (Phase 3): burner + WalletConnect modal + network-mismatch handler all PASS.
3. **Privacy verification** (Phase 4): explicit Etherscan event-log inspection proves no plaintext leak for Sealed Auction losers + Payments recipients.
4. **UI/UX sweep** (Phase 5): zero invisible-icon bugs, zero placeholder text, zero raw-hex errors exposed, all responsive breakpoints clean.
5. **Cross-feature regression** (Phase 6): combined flow completes without intervention.
6. **Bugs**: zero P0 open. Zero P1 open OR every open P1 has a documented workaround AND a tracking entry. P2s may remain open but must all be batched in a single "polish" commit at end.
7. **Final commit** on `main` with the message `chore(launch): autonomous QA run complete — all exit criteria green` AND a successful Vercel production deploy.
8. **Final summary** posted by the agent: list of features verified, count of bugs caught + fixed, link to `LAUNCH-RUN-LOG.md`, and the single sentence: **"Zerith is launch-ready on Sepolia."**

If even one criterion is not green, the run is NOT done. Keep going.

---

## 7. Stop conditions (when to break the loop and ask)

The agent is autonomous but is not reckless. Stop and ask the user when:

- A P0 fix requires touching a smart contract (re-deploy needed).
- A P0 fix requires rotating a secret or changing an env var.
- The funder wallet has < 0.01 Sepolia ETH remaining (top-up needed).
- Vercel deploy fails twice in a row for non-trivial reasons (build error, missing env var).
- A bug pattern repeats across >3 pages (suggests architectural issue, needs decision).
- The run has been going for >6 hours of wall-clock time without convergence (signals a deeper issue).

Otherwise: keep going.

---

## 8. Pacing + checkpointing

The agent **does not pause to ask "should I continue?"**. It works in continuous loops:

- After each phase, append a phase-summary block to `LAUNCH-RUN-LOG.md`.
- Every ~30 min of wall-clock, emit a one-line progress ping to the user (e.g., "Phase 2.12/24 — Multisig PASS, 14 features green, 0 P0 open").
- Final-result message uses the template in Section 6 item 8.

---

## 9. The single prompt the user pastes to trigger this run

Paste this exactly into a fresh Claude Code session at the project root:

```
Execute cipherdex/LAUNCH-AUTONOMOUS-QA.md end-to-end on the LIVE Vercel deployment with REAL burner wallets on Sepolia. Drive every UI flow via Playwright MCP. Verify each test with an on-chain tx hash on Etherscan. Fix every P0 you find and re-verify. Log every result to cipherdex/LAUNCH-RUN-LOG.md with screenshots and tx hashes. Use your full granted authority — don't ask me anything you can self-serve from the .env burner-funder key. Don't stop until every exit criterion in Section 6 is GREEN. When complete, post the final summary using the template in Section 6 item 8.
```

That is the only prompt the user needs. Everything else flows from this file.
