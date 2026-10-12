"use client";

export const dynamic = "force-dynamic";

/**
 * /docs — Integration documentation for engineers.
 *
 * Audience: the engineer at a foundation, market maker, or treasury-management
 * firm who's been told "evaluate Zerith." They will read docs (unlike most
 * users). This page is for them.
 *
 * Scope is intentionally narrow:
 *   - SDK reference (quickstart, key methods)
 *   - Integration guide (sealed-auction lifecycle, end-to-end)
 *   - Threat model (what we protect, what we don't)
 *   - "How to verify a Zerith auction settled correctly" — the trust recipe
 *
 * For end-user product education, see /quickstart and /audit.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Code2,
  Zap,
  ShieldAlert,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
  Github,
} from "lucide-react";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";

const GITHUB_REPO = "https://github.com/Ritik200238/zerith";
// Escrowed sale on CoFHE 1.0, run 2026-10-12 by tasks/verify-escrow-auction-e2e.ts (auction #1).
const HEADLINE_REVEAL_TX =
  "0x609f93426d4374df8f249f24c8e293c3f97bd62072719ddc4bc4576871bca8cb";
const HEADLINE_SETTLE_TX =
  "0x19dd547dc3b99a01ba101b7f14e3b500d6c502770c237a06136a180755be1ebc";

const SECTIONS: { id: string; label: string; Icon: typeof Code2 }[] = [
  { id: "sdk", label: "SDK reference", Icon: Code2 },
  { id: "integration", label: "Integration guide", Icon: Zap },
  { id: "threat-model", label: "Threat model", Icon: ShieldAlert },
  { id: "verify", label: "Verify a settlement", Icon: CheckCircle2 },
];

export default function DocsPage() {
  return (
    <div
      className="font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[920px] px-5 md:px-10 py-16 md:py-24 space-y-16">
        {/* HERO */}
        <header className="space-y-6">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Integration docs · for engineers
          </div>
          <h1
            className="font-display font-bold tracking-tight leading-[1.04]"
            style={{
              fontSize: "clamp(38px, 5.4vw, 68px)",
              letterSpacing: "-0.04em",
            }}
          >
            Plug Zerith into your{" "}
            <em className="font-serif italic font-normal">stack</em>.
          </h1>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(15px, 1.2vw, 17px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            Everything an engineer needs to evaluate, integrate, or audit Zerith
            in production: the TypeScript SDK, the end-to-end sealed-auction
            lifecycle, what we protect (and what we don&apos;t), and a step-by-step
            recipe to verify any Zerith auction settled correctly using only an
            Etherscan link.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderRadius: 8,
              }}
            >
              <Github size={14} /> View source <ExternalLink size={11} />
            </a>
            <Link
              href="/quickstart"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Or run the interactive quickstart <ArrowRight size={13} />
            </Link>
          </div>
        </header>

        {/* TABLE OF CONTENTS */}
        <section
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
          }}
          className="overflow-hidden"
        >
          <div
            className="px-5 py-3"
            style={{ borderBottom: "1px dashed var(--border-dash)" }}
          >
            <span
              className="font-mono uppercase tracking-[0.12em]"
              style={{ fontSize: 10, color: "var(--text-muted)" }}
            >
              — Contents
            </span>
          </div>
          <ol className="divide-y divide-dashed" style={{ borderColor: "var(--border-dash)" }}>
            {SECTIONS.map((s, i) => (
              <li
                key={s.id}
                style={{ borderTop: i === 0 ? "none" : "1px dashed var(--border-dash)" }}
              >
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors"
                  style={{ color: "var(--text)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-card-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      width: 24,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <s.Icon size={14} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{s.label}</span>
                  <ArrowRight size={12} style={{ marginLeft: "auto", color: "var(--text-muted)" }} />
                </a>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── SDK ─────────────────────────────────────────── */}
        <Section
          id="sdk"
          n={1}
          Icon={Code2}
          title="SDK reference"
          tagline="Typed TypeScript client for posting, bidding, and settling encrypted auctions."
        >
          <p>
            Zerith does not ship a bespoke client. The frontend integrates
            directly against two installed packages:{" "}
            <Code>@cofhe/sdk</Code> 0.8 (Fhenix CoFHE 1.0 — encryption,
            decryption, access permissions) and <Code>ethers v6</Code> (the on-chain calls, against the
            published contract ABIs). Every snippet below is exactly the pattern
            the app uses in{" "}
            <Code>frontend/src/providers/CofheProvider.tsx</Code> and the feature
            pages — copy-paste runnable against what&apos;s installed.
          </p>

          <Subhead>Install</Subhead>
          <CodeBlock
            language="bash"
            code={`npm install @cofhe/sdk@0.8.0 ethers`}
          />

          <Subhead>Initialize the CoFHE client</Subhead>
          <CodeBlock
            language="ts"
            code={`import { ethers } from "ethers";
// @cofhe/sdk ships WASM — import the web entrypoints client-side only.
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import { Ethers6Adapter } from "@cofhe/sdk/adapters";
import { chains } from "@cofhe/sdk/chains";

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
const signer = new ethers.Wallet(privateKey, provider);

const cofhe = createCofheClient(
  createCofheConfig({ supportedChains: [chains.sepolia] }),
);
const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);
await cofhe.connect(publicClient, walletClient);`}
          />

          <Subhead>Most-used methods</Subhead>
          <Table
            rows={[
              [
                <Code key="m1">cofhe.encryptInputs([Encryptable.uint64(v)]).setConsumingContract(addr).execute()</Code>,
                "Encrypt client-side with a ZK proof. Inputs are bound to the contract that consumes them, and a batch shares one signature: the result is [...handles, signature], which maps straight onto (externalEuint64 handle, bytes proof) contract arguments.",
              ],
              [
                <Code key="m2">cofhe.decryptForView(ctHash, FheTypes.Uint64).withACP().execute()</Code>,
                "Decrypt a handle your address is allowed to read, using your self ACP (Access Control Permission). Other accounts are refused.",
              ],
              [
                <Code key="m3">cofhe.decryptForTx(handle).withoutACP().execute()</Code>,
                "Fetch a Threshold-Network-signed (value, signature) pair for a handle the contract made public, then submit it on-chain (e.g. confirmLot, reveal). Anyone can do this.",
              ],
              [
                <Code key="m4">cofhe.acp.getOrCreateSelfACP()</Code>,
                "Ensure you have an active self ACP. The first call asks your wallet to sign once.",
              ],
              [
                <Code key="m5">new ethers.Contract(addr, abi, signer)</Code>,
                "Plain ethers v6 contract instance for the on-chain calls. Addresses are in deployed-addresses.json.",
              ],
            ]}
          />

          <Subhead>End-to-end example</Subhead>
          <CodeBlock
            language="ts"
            code={`import { Encryptable, FheTypes } from "@cofhe/sdk";

// cofhe + signer are set up as above. token / vault / sealedAuction are
// ethers.Contract instances built from deployed-addresses.json + the ABIs.

// 1. Fund your vault. Bids lock funds from this balance, so deposit first.
//    Authorize the vault as an FHERC-20 operator once (approve() reverts by design).
const MAX_UINT48 = "281474976710655"; // 2**48 - 1
if (!(await token.isOperator(wallet.address, vaultAddr))) {
  await (await token.setOperator(vaultAddr, MAX_UINT48)).wait();
}
const [depositHandle, depositProof] = await cofhe
  .encryptInputs([Encryptable.uint64(500_000000n)]) // 500 tokens, 6 decimals
  .setConsumingContract(vaultAddr)
  .execute();
await (await vault.deposit(tokenAddr, depositHandle, depositProof)).wait();

// 2. Bid on auction #0. The amount is locked from your vault balance;
//    if you can't cover it, nothing is locked and the bid can't win.
const [bidHandle, bidProof] = await cofhe
  .encryptInputs([Encryptable.uint64(120_000000n)])
  .setConsumingContract(auctionAddr)
  .execute();
await (await sealedAuction.bid(0, bidHandle, bidProof)).wait();

// 3. Unseal your own bid (the amount actually locked). Only you can.
await cofhe.acp.getOrCreateSelfACP();
const myBid = await cofhe
  .decryptForView(BigInt(await sealedAuction.getMyBid(0)), FheTypes.Uint64)
  .withACP()
  .execute();`}
          />
        </Section>

        {/* ─── INTEGRATION ──────────────────────────────── */}
        <Section
          id="integration"
          n={2}
          Icon={Zap}
          title="Integration guide"
          tagline="The end-to-end sealed-auction lifecycle, contract calls, and event hooks."
        >
          <p>
            Every bid and the seller&apos;s lot are locked in the settlement
            vault, so a sale settles atomically from escrow: the winner always
            pays exactly the winning bid and always receives the lot. After
            creation, every step except cancelling can be triggered by anyone.
          </p>

          <Subhead>State machine</Subhead>
          <Table
            rows={[
              [<Code key="s6">PENDING_LOT</Code>, "Created; the lot was locked from the seller's vault. Waiting for the Threshold Network to confirm the full lot was there."],
              [<Code key="s0">OPEN</Code>, "Lot confirmed. Accepts encrypted bids until the deadline (late bids extend it)."],
              [<Code key="s1">CLOSED</Code>, "Anyone closed it after the deadline. The outcome handles are now publicly decryptable."],
              [<Code key="s2">REVEALED</Code>, "Threshold-Network-signed winner and winning bid were verified on-chain."],
              [<Code key="s3">SETTLED</Code>, "Escrow paid the seller (minus the 2% fee) and sent the lot to the winner. Losers claim refunds."],
              [<Code key="s4">CANCELLED</Code>, "Unfunded lot, no bids by the deadline, or the seller cancelled before any bid. The lot goes back."],
              [<Code key="s5">NO_SALE</Code>, "Blind Floor only: the reserve wasn't met. Nothing about any bid is revealed; the lot and all bids are refunded."],
            ]}
          />

          <Subhead>Lifecycle, by contract call</Subhead>
          <CodeBlock
            language="ts"
            code={`// ─── Seller ─── (deposit the lot into the vault first)
await sealedAuction.createAuction(lotToken, paymentToken, lotAmount, duration, snipeExtension);
// Anyone: publish the Threshold Network's check that the lot was fully locked
const lot = await cofhe.decryptForTx(await sealedAuction.getLotFundedHandle(id)).withoutACP().execute();
await sealedAuction.confirmLot(id, lot.decryptedValue === 1n, lot.signature);

// ─── Bidders ─── (each bid locks funds from the bidder's vault balance)
const [h, proof] = await cofhe.encryptInputs([Encryptable.uint64(amount)])
  .setConsumingContract(auctionAddr).execute();
await sealedAuction.bid(id, h, proof);

// ─── Anyone, after the deadline ───
await sealedAuction.closeAuction(id);
const [okH, bidH, winnerH] = await sealedAuction.getRevealHandles(id);
const ok = await cofhe.decryptForTx(okH).withoutACP().execute();
const bid = await cofhe.decryptForTx(bidH).withoutACP().execute();
const win = await cofhe.decryptForTx(winnerH).withoutACP().execute();
await sealedAuction.reveal(id, ok.decryptedValue === 1n, ok.signature,
  bid.decryptedValue, bid.signature, toAddress(win.decryptedValue), win.signature);
await sealedAuction.settleAuction(id);

// ─── Each losing bidder ─── (refund stays encrypted; it is never decrypted)
await sealedAuction.claimRefund(id);`}
          />

          <Subhead>Events to subscribe to</Subhead>
          <Table
            rows={[
              [<Code key="e1">AuctionCreated</Code>, "auctionId, seller, token, amount, duration"],
              [<Code key="e0">LotConfirmed</Code>, "auctionId, funded, deadline"],
              [<Code key="e2">BidPlaced</Code>, "auctionId, bidder, newDeadline (anti-snipe extension)"],
              [<Code key="e3">AuctionClosed</Code>, "auctionId"],
              [<Code key="e4">WinnerRevealed</Code>, "auctionId, winner, winningBid (plaintext)"],
              [<Code key="e6">NoSale</Code>, "auctionId — Blind Floor reserve not met"],
              [<Code key="e5">AuctionSettled</Code>, "auctionId — escrow paid out"],
              [<Code key="e7">RefundClaimed</Code>, "auctionId, bidder"],
            ]}
          />

          <p
            className="text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            None of these events leak losing-bidder information. The chain
            stores the full set of encrypted bids forever, but they remain
            cryptographically inaccessible.
          </p>
        </Section>

        {/* ─── THREAT MODEL ──────────────────────────────── */}
        <Section
          id="threat-model"
          n={3}
          Icon={ShieldAlert}
          title="Threat model"
          tagline="What Zerith protects against, what it does not."
        >
          <Subhead>What we protect</Subhead>
          <ul className="space-y-3">
            <Bullet
              ok
              title="Losing bid amounts."
              body="Encrypted on-chain forever. No FHE.allowGlobal is ever called on losing handles. Even the protocol deployer cannot decrypt them."
            />
            <Bullet
              ok
              title="Cross-account decryption."
              body="The threshold network refuses requests where the caller doesn't own the handle. Bidder #2 cannot unseal Bidder #1's bid."
            />
            <Bullet
              ok
              title="Pre-trade leakage to MEV."
              body="Bid amounts are ciphertext at submission. Searchers see encrypted input handles, not numbers. There is nothing to sandwich."
            />
            <Bullet
              ok
              title="Reserve price (Blind Floor mode)."
              body="The encrypted reserve is never decrypted. The chain publishes only whether the sale went through, and if it didn't, neither the winner nor the winning bid is revealed."
            />
          </ul>

          <Subhead>What we do NOT protect (yet)</Subhead>
          <ul className="space-y-3">
            <Bullet
              warn
              title="Bidder identity."
              body="Bidder addresses are public on-chain. To anonymize who bid, route through a fresh wallet (the burner flow) or a privacy mixer at the transaction level. We do not bundle that."
            />
            <Bullet
              warn
              title="Auction existence + size."
              body="The fact that an auction was posted, by whom, for what token quantity, on what deadline — all public. We seal the prices, not the trade itself. This is intentional: foundations want their sale to be discoverable."
            />
            <Bullet
              warn
              title="Threshold network availability."
              body="Lot confirmation and the reveal need the Threshold Network to co-sign. If it's unreachable, the sale is delayed, not lost: closing and revealing are open to anyone and can be retried the moment the network returns. While it's down, escrowed bids and the lot stay locked; there is no on-chain timeout that refunds them without a reveal."
            />
            <Bullet
              warn
              title="On-chain censorship / mempool ordering."
              body="MEV searchers cannot front-run the bid (they can't read it), but they can reorder transactions inside a block. For sealed auctions this only affects bid arrival timing within anti-snipe windows."
            />
          </ul>

          <Subhead>Cryptographic assumptions</Subhead>
          <Table
            rows={[
              [
                "FHE security",
                "Fhenix CoFHE uses TFHE-rs. Security reduces to standard learning-with-errors hardness assumptions. We rely on the upstream library; we do not roll our own crypto.",
              ],
              [
                "Threshold network",
                "Decryptions are performed by Fhenix's Threshold Network. On-chain, contracts verify one ECDSA signature from it (FHE.publishDecryptResult). Any quorum among its operators happens off-chain, so this is a trust assumption on Fhenix's network, which can in principle decrypt any handle.",
              ],
              [
                "Access permissions (ACPs)",
                "Each user signs a self ACP once. It gates decrypt-to-view of their own values (balance, bid). A leaked ACP lets someone read only what that user can read, and ACPs can be revoked on-chain.",
              ],
            ]}
          />
        </Section>

        {/* ─── VERIFY ────────────────────────────────────── */}
        <Section
          id="verify"
          n={4}
          Icon={CheckCircle2}
          title="Verify a settlement"
          tagline="From an Etherscan link, prove a Zerith auction cleared correctly."
        >
          <p>
            This is the load-bearing check. Anyone with an Etherscan link
            can verify a Zerith auction settled correctly without trusting
            us, without running a node, without an account.
          </p>

          <Subhead>The headline tx</Subhead>
          <p>
            The canonical example we point reviewers at:
          </p>
          <ExplorerLink
            label="Escrowed sealed sale · 3 bidders · winner revealed"
            href={`${FHENIX_TESTNET.blockExplorer}/tx/${HEADLINE_REVEAL_TX}`}
            tx={HEADLINE_REVEAL_TX}
          />

          <Subhead>Step-by-step</Subhead>
          <ol
            className="space-y-3 list-decimal pl-5"
            style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.7 }}
          >
            <li>
              <strong style={{ color: "var(--text)" }}>
                Open the reveal tx on Etherscan.
              </strong>{" "}
              Confirm <Code>To:</Code> matches the SealedAuction address in our{" "}
              <a
                href={`${FHENIX_TESTNET.blockExplorer}/address/${CONTRACTS.SealedAuction}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
                style={{ color: "var(--text)" }}
              >
                deployed-addresses.json
              </a>
              .
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>
                Decode the input data.
              </strong>{" "}
              Etherscan&apos;s "Decode Input Data" reveals the function call:{" "}
              <Code>reveal(auctionId, saleOk, sig, winningBid, sig, winner, sig)</Code>.
              Note the plaintext <Code>winningBid</Code> and{" "}
              <Code>winner</Code> — these were just decrypted by the threshold
              network and verified on-chain.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>
                Read the SealedAuction source.
              </strong>{" "}
              It&apos;s{" "}
              <a
                href={`${FHENIX_TESTNET.blockExplorer}/address/${CONTRACTS.SealedAuction}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
                style={{ color: "var(--text)" }}
              >
                verified on Etherscan
              </a>
              , so you can check it matches this repository. Confirm that <Code>reveal()</Code> calls{" "}
              <Code>FHE.publishDecryptResult(handle, value, signature)</Code> —
              this is the precompile that verifies the threshold network
              signature against the ciphertext handle. If it returns{" "}
              <Code>false</Code>, the call reverts.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>
                Read the storage slot for losing bids.
              </strong>{" "}
              <Code>bids[auctionId][bidderAddr]</Code> stores the encrypted
              handle for every bidder. Anyone can read these slots; nobody can
              decrypt them. The losing bid handles for this auction sit in
              storage forever.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>
                Try to decrypt a losing bid yourself.
              </strong>{" "}
              Call <Code>cofhe.decryptForTx(handle).withoutACP().execute()</Code>{" "}
              from a wallet that didn&apos;t place that bid. The threshold
              network refuses — we never called <Code>FHE.allowGlobal</Code>{" "}
              on losing handles, so they remain owner-restricted.
            </li>
          </ol>

          <Subhead>Spot-check the math</Subhead>
          <p>
            For the headline tx specifically:
          </p>
          <Table
            rows={[
              ["Bidders", "300 and 450 CDEX (each funded), plus 5,000 from a wallet with an empty vault"],
              ["Winner revealed", "the 450 bidder ✓ — the unfunded 5,000 bid locked nothing and couldn't win"],
              ["Losing bids", "the 300 bid stays an encrypted handle forever; it was refunded as ciphertext"],
              [
                "Settlement",
                <a
                  key="s"
                  href={`${FHENIX_TESTNET.blockExplorer}/tx/${HEADLINE_SETTLE_TX}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--text)" }}
                  className="underline hover:opacity-80"
                >
                  escrow paid the seller 441 (450 − 2% fee) and sent the 2,000 MOCK lot to the winner
                </a>,
              ],
              [
                "Verify yourself",
                <a
                  key="v"
                  href={`${FHENIX_TESTNET.blockExplorer}/tx/${HEADLINE_REVEAL_TX}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--text)" }}
                  className="underline hover:opacity-80"
                >
                  open the tx
                </a>,
              ],
            ]}
          />
        </Section>

        {/* ─── FOOTER ────────────────────────────────────── */}
        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />
        <footer className="space-y-4">
          <p
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Need more depth
          </p>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: "var(--text-secondary)",
              maxWidth: 640,
            }}
          >
            Source-level documentation lives in the repo. The full reviewer
            replay path, every verified Sepolia transaction, and the launch
            QA results are linked from the README.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              <Github size={14} /> GitHub <ExternalLink size={11} />
            </a>
            <Link
              href="/audit"
              className="inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Privacy audit page <ArrowRight size={13} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Contact us <ArrowRight size={13} />
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────── */

function Section({
  id,
  n,
  Icon,
  title,
  tagline,
  children,
}: {
  id: string;
  n: number;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  tagline: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-6 scroll-mt-24">
      <header className="space-y-3">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em] flex items-center gap-2"
          style={{ color: "var(--text-muted)" }}
        >
          <Icon size={12} />
          Section {String(n).padStart(2, "0")}
        </div>
        <h2
          className="font-display font-bold tracking-tight"
          style={{
            fontSize: "clamp(28px, 3.4vw, 42px)",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            maxWidth: 640,
          }}
        >
          {tagline}
        </p>
      </header>
      <div
        className="space-y-5"
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text-secondary)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="font-display font-semibold pt-2"
      style={{
        fontSize: 17,
        letterSpacing: "-0.015em",
        color: "var(--text)",
      }}
    >
      {children}
    </h3>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="font-mono"
      style={{
        fontSize: "0.85em",
        background: "var(--bg-alt)",
        border: "1px dashed var(--border-dash)",
        borderRadius: 3,
        padding: "1px 6px",
        color: "var(--text)",
        // Long calls like decryptForTx(...).withoutACP().execute() must wrap on phones.
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </code>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "var(--bg-alt)",
        border: "1px dashed var(--border-dash)",
        borderRadius: 4,
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px dashed var(--border-dash)" }}
      >
        <span
          className="font-mono uppercase tracking-[0.12em]"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          {language}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="font-mono uppercase tracking-[0.12em] inline-flex items-center gap-1.5 transition-colors"
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto px-4 py-4 font-mono"
        style={{
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--text)",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Table({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: 4,
      }}
    >
      {rows.map(([left, right], i) => (
        <div
          key={i}
          className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 md:gap-6 px-5 py-4"
          style={
            i < rows.length - 1
              ? { borderBottom: "1px dashed var(--border-dash)" }
              : undefined
          }
        >
          <div style={{ color: "var(--text)", fontWeight: 500, fontSize: 13.5 }}>
            {left}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6 }}>
            {right}
          </div>
        </div>
      ))}
    </div>
  );
}

function Bullet({
  ok,
  warn,
  title,
  body,
}: {
  ok?: boolean;
  warn?: boolean;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 items-start">
      <span
        className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full"
        style={{
          background: ok
            ? "var(--success)"
            : warn
              ? "var(--warning)"
              : "var(--text-muted)",
        }}
      />
      <div>
        <p
          className="font-display font-semibold"
          style={{
            fontSize: 14,
            color: "var(--text)",
            letterSpacing: "-0.005em",
            marginBottom: 2,
          }}
        >
          {title}
        </p>
        <p
          style={{
            fontSize: 13.5,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}

function ExplorerLink({
  label,
  href,
  tx,
}: {
  label: string;
  href: string;
  tx: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors"
      style={{
        background: "var(--bg-alt)",
        border: "1px dashed var(--border-dash)",
        borderRadius: 4,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-card-hover)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-alt)")}
    >
      <div className="min-w-0 flex flex-col gap-1">
        <span
          className="font-mono uppercase tracking-[0.12em]"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          — Etherscan
        </span>
        <span
          className="font-display font-semibold"
          style={{ fontSize: 14, color: "var(--text)" }}
        >
          {label}
        </span>
        <span
          className="font-mono break-all"
          style={{ fontSize: 11, color: "var(--text-muted)" }}
        >
          {tx}
        </span>
      </div>
      <ExternalLink size={14} style={{ color: "var(--text-muted)" }} />
    </a>
  );
}
