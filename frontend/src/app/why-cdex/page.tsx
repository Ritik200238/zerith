"use client";

export const dynamic = "force-dynamic";

/**
 * Why CDEX — /why-cdex
 *
 * Pre-empts the support question "why does my token say CipherDEX in
 * MetaMask when the site says Zerith?" Editorial design, single-page,
 * answers in three beats:
 *   1. The reality (CDEX is the ticker; Zerith is the brand)
 *   2. Why we can't change it (ERC-20 metadata is immutable)
 *   3. What it means for you (nothing — just heads-up)
 */

import Link from "next/link";
import { ArrowRight, Lock, Hash, RefreshCw, ExternalLink } from "lucide-react";
import { CONTRACTS, FHENIX_TESTNET, TOKEN_CONFIG } from "@/lib/constants";

export default function WhyCdexPage() {
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
            — Why CDEX
          </div>
          <h1
            className="font-display font-bold tracking-tight leading-[1.04]"
            style={{
              fontSize: "clamp(38px, 5.4vw, 68px)",
              letterSpacing: "-0.04em",
            }}
          >
            Same protocol.{" "}
            <em className="font-serif italic font-normal">Two names</em>.
          </h1>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(15px, 1.2vw, 17px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            The site says Zerith. The token in your wallet says CipherDEX
            with the symbol <code>CDEX</code>. Both are correct. Here&apos;s
            why, in two minutes.
          </p>
        </header>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* THE REALITY */}
        <section className="space-y-5">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Section 01
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.1]"
            style={{
              fontSize: "clamp(24px, 2.8vw, 34px)",
              letterSpacing: "-0.02em",
            }}
          >
            What you see in your wallet
          </h2>
          <p
            className="max-w-2xl"
            style={{
              fontSize: 15.5,
              lineHeight: 1.75,
              color: "var(--text-secondary)",
            }}
          >
            When you claim test tokens or check your balance, your wallet
            shows the on-chain metadata of the token contract. The
            contract was originally deployed under the project&apos;s
            previous name, and was deployed with these constants:
          </p>

          {/* On-chain field card */}
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px dashed var(--border-dash)",
              borderRadius: 4,
            }}
            className="overflow-hidden"
          >
            <FieldRow
              label="name()"
              value="CipherDEX Token"
              caption="The full name your wallet displays."
            />
            <FieldRow
              label="symbol()"
              value="CDEX"
              caption="The ticker, used in MetaMask and on Etherscan."
            />
            <FieldRow
              label="decimals()"
              value="6"
              caption="6 decimals (USDC-style), not 18."
              isLast
            />
          </div>

          <div
            className="flex items-center gap-3 pt-2 flex-wrap"
            style={{ color: "var(--text-muted)" }}
          >
            <Hash size={13} />
            <span className="font-mono text-xs">
              Contract:{" "}
              <a
                href={`${FHENIX_TESTNET.blockExplorer}/address/${CONTRACTS.ConfidentialToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline inline-flex items-center gap-1"
                style={{ color: "var(--text)" }}
              >
                {CONTRACTS.ConfidentialToken.slice(0, 8)}…
                {CONTRACTS.ConfidentialToken.slice(-6)}
                <ExternalLink size={11} />
              </a>
            </span>
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* WHY WE CANNOT CHANGE IT */}
        <section className="space-y-5">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Section 02
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.1]"
            style={{
              fontSize: "clamp(24px, 2.8vw, 34px)",
              letterSpacing: "-0.02em",
            }}
          >
            Why we can&apos;t just{" "}
            <em className="font-serif italic font-normal">rename it</em>.
          </h2>
          <p
            className="max-w-2xl"
            style={{
              fontSize: 15.5,
              lineHeight: 1.75,
              color: "var(--text-secondary)",
            }}
          >
            ERC-20 token metadata —{" "}
            <code>name</code>, <code>symbol</code>, <code>decimals</code> —
            is set in the constructor and stored in immutable storage.
            There is no <code>setName</code> function on a standard ERC-20.
            That immutability is the property exchanges, wallets, and
            indexers rely on. Tokens that change their ticker on the fly
            are a phishing vector, not a feature.
          </p>
          <p
            className="max-w-2xl"
            style={{
              fontSize: 15.5,
              lineHeight: 1.75,
              color: "var(--text-secondary)",
            }}
          >
            We could deploy a fresh token with the symbol{" "}
            <code>ZER</code> and migrate balances — but that creates
            two tokens, two contract addresses, two markets, and forces
            every previous user to take a manual migration action. The
            cure is worse than the inconsistency. So we keep{" "}
            <code>CDEX</code> on-chain and use Zerith everywhere else.
          </p>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* WHAT IT MEANS */}
        <section className="space-y-5">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Section 03
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.1]"
            style={{
              fontSize: "clamp(24px, 2.8vw, 34px)",
              letterSpacing: "-0.02em",
            }}
          >
            What it means for you.
          </h2>

          <ul className="space-y-4 max-w-2xl">
            <Bullet
              Icon={Lock}
              title="Nothing functional changes."
              body="Every encrypted bid, every auction, every payment, every claim works the same. The ticker is a label."
            />
            <Bullet
              Icon={RefreshCw}
              title="The same contract is the same contract."
              body="If you held CDEX before, you still hold it. No re-claim. No migration. No replay."
            />
            <Bullet
              Icon={Hash}
              title="The pre-mainnet token will have a clean ticker."
              body="When we deploy production-grade contracts on Arbitrum mainnet, the settlement token will launch under a final ticker. CDEX is and will remain the testnet/Sepolia token."
            />
          </ul>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* CTA */}
        <section className="space-y-5">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Still have questions
          </div>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(17px, 1.5vw, 22px)",
              fontWeight: 600,
              lineHeight: 1.5,
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            The <em className="font-serif italic font-normal">/contact</em>{" "}
            page has a 12-question FAQ and a direct line to a human.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderRadius: 8,
              }}
            >
              Read the FAQ <ArrowRight size={14} />
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              See the privacy audit <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─── sub-components ────────────────────────────────────── */

function FieldRow({
  label,
  value,
  caption,
  isLast,
}: {
  label: string;
  value: string;
  caption: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="px-5 py-4 flex items-baseline justify-between gap-6 flex-wrap"
      style={
        isLast
          ? undefined
          : { borderBottom: "1px dashed var(--border-dash)" }
      }
    >
      <div className="flex flex-col">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.12em]"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
        <span
          className="text-xs mt-0.5"
          style={{ color: "var(--text-muted)" }}
        >
          {caption}
        </span>
      </div>
      <span
        className="font-display font-semibold"
        style={{
          fontSize: 18,
          letterSpacing: "-0.01em",
          color: "var(--text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Bullet({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-4">
      <span
        className="shrink-0 w-9 h-9 mt-0.5 flex items-center justify-center"
        style={{
          background: "var(--bg-alt)",
          border: "1px dashed var(--border-dash)",
          borderRadius: 4,
        }}
      >
        <Icon size={14} className="text-text" />
      </span>
      <div>
        <p
          className="font-display font-semibold"
          style={{
            fontSize: 16,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            marginBottom: 4,
          }}
        >
          {title}
        </p>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            lineHeight: 1.65,
          }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}

/* Suppress unused-import lint for TOKEN_CONFIG which is used implicitly via the
 * symbol shown in /audit; keep for future row additions. */
const _u = TOKEN_CONFIG;
