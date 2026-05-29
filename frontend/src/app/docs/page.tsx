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
const HEADLINE_REVEAL_TX =
  "0x98a1c650b8f992dacba8580ac25aa1c1960bde1d37fa490697a9a143014fafc7";

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
            <Code>@cofhe/sdk</Code> (Fhenix CoFHE — encryption, decryption,
            permits) and <Code>ethers v6</Code> (the on-chain calls, against the
            published contract ABIs). Every snippet below is exactly the pattern
            the app uses in{" "}
            <Code>frontend/src/providers/CofheProvider.tsx</Code> and the feature
            pages — copy-paste runnable against what&apos;s installed.
          </p>

          <Subhead>Install</Subhead>
          <CodeBlock
            language="bash"
            code={`npm install @cofhe/sdk cofhejs ethers`}
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
                <Code key="m1">cofhe.encryptInputs([Encryptable.uint128(amount)]).execute()</Code>,
                "Encrypt a value client-side into an InEuint128 (with a ZK proof of validity). Pass the returned handle to the contract call. Use Encryptable.uint64(...) for euint64 amounts.",
              ],
              [
                <Code key="m2">cofhe.decryptForView(ctHash, FheTypes.Uint128).execute()</Code>,
                "Decrypt your own handle locally via the threshold network, gated by your permit. Cross-account calls are rejected by the TN — you can only unseal handles your address owns.",
              ],
              [
                <Code key="m3">cofhe.decryptForTx(handle).withoutPermit().execute()</Code>,
                "Fetch a TN co-signed (value, signature) pair for an FHE.allowGlobal'd handle, then submit it on-chain (e.g. revealWinner). Permissionless once the handle is globally allowed.",
              ],
              [
                <Code key="m4">cofhe.permits.getOrCreateSelfPermit()</Code>,
                "Idempotently ensure an active self-permit exists. Permits gate decryptForView; they last ~24h and auto-rotate in the app.",
              ],
              [
                <Code key="m5">new ethers.Contract(addr, abi, signer)</Code>,
                "Plain ethers v6 contract instance for the on-chain calls — createAuction, bid, closeAuction, revealWinner, vault.deposit. Addresses live in deployed-addresses.json.",
              ],
            ]}
          />

          <Subhead>End-to-end example</Subhead>
          <CodeBlock
            language="ts"
            code={`import { Encryptable } from "@cofhe/sdk";
import { FheTypes } from "@cofhe/sdk";

// cofhe + signer are set up as above. SealedAuction / SettlementVault are
// ethers.Contract instances built from deployed-addresses.json + the ABIs.

// 1. Fund the vault first. deposit pulls from your wallet via the FHERC-20,
//    so you must authorize the vault as an operator once (FHERC20.approve
//    reverts by design — use setOperator instead).
const MAX_UINT48 = "281474976710655"; // 2**48 - 1
if (!(await token.isOperator(wallet.address, vaultAddr))) {
  await (await token.setOperator(vaultAddr, MAX_UINT48)).wait();
}
const [encDeposit] = (await cofhe.encryptInputs([Encryptable.uint64(100n)]).execute());
await (await vault.deposit(tokenAddr, encDeposit)).wait();

// 2. Bid on auction #4 with an encrypted price (euint128 -> Encryptable.uint128).
const [encBid] = (await cofhe.encryptInputs([Encryptable.uint128(1200n)]).execute());
const tx = await sealedAuction.bid(4, encBid);
console.log("bid tx:", tx.hash);

// 3. Later, unseal your own bid (only you can — bids are euint128).
const myBid = await cofhe.decryptForView(await sealedAuction.getMyBid(4), FheTypes.Uint128).execute();
console.log("my bid was:", myBid); // 1200n`}
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
            A sealed auction goes through five states. Each transition is
            permissionless on the bidder side — anyone holding allowed
            FHERC-20 tokens can post a bid, anyone can trigger reveal once the
            deadline lapses.
          </p>

          <Subhead>State machine</Subhead>
          <Table
            rows={[
              [<Code key="s0">OPEN</Code>, "Created. Accepts bids until the deadline."],
              [<Code key="s1">CLOSED</Code>, "Deadline passed or seller closed early. No more bids accepted."],
              [<Code key="s2">REVEALED</Code>, "Threshold network co-signed the winning bid + bidder. Plaintext recorded."],
              [<Code key="s3">SETTLED</Code>, "Settlement vault transferred tokens between winner and seller."],
              [<Code key="s4">CANCELLED</Code>, "Seller cancelled before any bids landed."],
              [
                <Code key="s5">RESERVE_NOT_MET</Code>,
                "Blind Floor only — the encrypted reserve check returned false at reveal. Seller refunded; bidders refunded.",
              ],
            ]}
          />

          <Subhead>Lifecycle, by contract call</Subhead>
          <CodeBlock
            language="ts"
            code={`// ─── Seller ───
const auctionId = await sealedAuction.createAuction(
  tokenForSale,    // address of the FHERC-20 being sold
  paymentToken,    // address of the FHERC-20 bidders pay with
  amount,          // plaintext amount being sold
  duration,        // seconds
  snipeExtension,  // anti-snipe extension on late bids
);

// ─── Bidder (multiple, each one independent) ───
// The InEuint128 is constructed via cofhejs with a ZK proof of validity.
const encBid = await cofhe.encryptInputs([Encryptable.uint128(1200n)]).execute();
await sealedAuction.bid(auctionId, encBid[0]);

// ─── Anyone (after deadline) ───
await sealedAuction.closeAuction(auctionId);
// Threshold network co-signs the highest-bid reveal off-chain
const proof = await cofhe.decryptForTx(highestBidHandle).withoutPermit().execute();
await sealedAuction.revealWinner(
  auctionId,
  proof.decryptedValue,
  proof.signature,
  bidderAddr,
  bidderProof.signature,
);

// ─── Vault settles ───
await sealedAuction.settleAuction(auctionId);`}
          />

          <Subhead>Events to subscribe to</Subhead>
          <Table
            rows={[
              [<Code key="e1">AuctionCreated</Code>, "auctionId, seller, token, amount, deadline"],
              [<Code key="e2">BidPlaced</Code>, "auctionId, bidder, newDeadline (anti-snipe extension)"],
              [<Code key="e3">AuctionClosed</Code>, "auctionId"],
              [<Code key="e4">WinnerRevealed</Code>, "auctionId, winner, winningBid (plaintext)"],
              [<Code key="e5">AuctionSettled</Code>, "auctionId — vault transfer complete"],
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
              body="Bid amounts are ciphertext at submission. Searchers see InEuint128 handles, not numbers. There is nothing to sandwich."
            />
            <Bullet
              ok
              title="Reserve price (Blind Floor mode)."
              body="The encrypted reserve is never decrypted. The chain publishes only the boolean outcome of FHE.gte(highestBid, reserve)."
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
              body="Decryption-on-reveal requires the FHE network to co-sign. If the network is unreachable, settlement is delayed (not lost): once a handle is FHE.allowGlobal'd at close, reveal is permissionless — anyone can fetch the co-signed result and submit revealWinner the moment the network returns. Note: the auctions have no on-chain emergency-refund. A 7-day EMERGENCY_TIMEOUT exists only on FreelanceBidding (escrowed jobs stuck in settling); do not assume it covers sealed auctions."
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
                "Reveals require a quorum of independent operators to co-sign. Compromise of fewer than the threshold leaks nothing. Compromise of the threshold compromises decryption (but not the encryption — past auctions stay sealed).",
              ],
              [
                "Permits",
                "Each user holds a 30-day permit signed once. Permits gate decryption-on-view (own balance, own bid). Compromise of a permit allows the attacker to decrypt only what that user is allowed to see.",
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
            label="Sealed auction · 3 bidders · winner revealed"
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
              <Code>revealWinner(auctionId, winningBid, signature, winner, bidderSig)</Code>.
              Note the plaintext <Code>winningBid</Code> and{" "}
              <Code>winner</Code> — these were just decrypted by the threshold
              network and verified on-chain.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>
                Read the SealedAuction source.
              </strong>{" "}
              Confirm that <Code>revealWinner()</Code> calls{" "}
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
              Call <Code>cofhe.decryptForTx(handle).withoutPermit().execute()</Code>{" "}
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
              ["Bidders", "burner1 (500), burner2 (800), burner3 (1200)"],
              ["Winner revealed", "burner3 / 1200 ✓ matches highest bid"],
              ["Losing bids in storage", "burner1 / burner2 — encrypted handles, never decrypted"],
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
