"use client";

export const dynamic = "force-dynamic";

import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { PrivacyStages } from "@/components/shared/PrivacyStages";
import { TreasuryFlow } from "@/components/shared/TreasuryFlow";
import { ActivityFeed } from "@/components/shared/ActivityFeed";
import { FaucetButton } from "@/components/shared/FaucetButton";
import Link from "next/link";
import {
  Rocket,
  CreditCard,
  ArrowLeftRight,
  Briefcase,
  Lock,
  ArrowRight,
  EyeOff,
  AlertTriangle,
  Workflow,
} from "lucide-react";

/* ─── Capability cards ─────────────────────────────────────── */

const CAPABILITIES = [
  {
    title: "Launch",
    subtitle: "5 auction types",
    description:
      "Sealed, Vickrey, Dutch, Batch, Overflow — every token launch format with encrypted bids.",
    href: "/auctions",
    icon: Rocket,
  },
  {
    title: "Pay",
    subtitle: "Private splits",
    description:
      "Split payments across recipients. Each sees only their own encrypted amount.",
    href: "/payments",
    icon: CreditCard,
  },
  {
    title: "Trade",
    subtitle: "MEV-proof orders",
    description:
      "Hidden limit orders, P2P matching, OTC board. Zero front-running possible.",
    href: "/trade",
    icon: ArrowLeftRight,
  },
  {
    title: "Hire",
    subtitle: "Encrypted bidding",
    description:
      "Post jobs, receive sealed bids, milestone escrow. Budgets stay confidential.",
    href: "/freelance",
    icon: Briefcase,
  },
];

/* ─── Innovation highlights ────────────────────────────────── */

const INNOVATIONS = [
  {
    title: "Blind Floor",
    description:
      "Dutch auctions with encrypted purchase amounts. See the price, hide the size.",
    icon: EyeOff,
  },
  {
    title: "Encrypted Disputes",
    description:
      "Freelance milestone disputes resolved without revealing bid prices to arbitrators.",
    icon: AlertTriangle,
  },
  {
    title: "Cross-Feature Flow",
    description:
      "Launch tokens via auction, pay contributors via splits, trade on OTC — one protocol.",
    icon: Workflow,
  },
];

/* ─── Page ──────────────────────────────────────────────────── */

export default function DashboardPage() {
  const { account } = useWallet();
  useCofhe();

  return (
    <div
      className="font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1180px] px-5 md:px-10 py-16 md:py-24 space-y-24 md:space-y-32">

        {/* ═══════ HERO ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Private finance infrastructure
          </div>

          <h1
            className="font-display font-bold tracking-tight leading-[1.02] mb-6"
            style={{
              fontSize: "clamp(46px, 6.2vw, 82px)",
              letterSpacing: "-0.04em",
            }}
          >
            Every number,{" "}
            <em className="font-serif italic font-normal">encrypted</em>.<br />
            Every operation,{" "}
            <em className="font-serif italic font-normal">composable</em>.
          </h1>

          <p
            className="max-w-2xl mb-10"
            style={{
              fontSize: "clamp(16px, 1.3vw, 18px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            Zerith is the encrypted operating system for DAOs. Launch tokens
            via sealed auctions. Pay contributors with encrypted splits. Trade
            without MEV. Hire without revealing budgets. All powered by{" "}
            <span className="gradient-text font-semibold">
              fully homomorphic encryption
            </span>{" "}
            on Fhenix.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {!account ? (
              <div
                className="inline-flex items-center gap-2 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.1em]"
                style={{
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  background: "var(--bg-card)",
                }}
              >
                <Lock size={12} /> Connect wallet to enter the protocol
              </div>
            ) : (
              <>
                <Link
                  href="/payments"
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{
                    background: "var(--text)",
                    color: "var(--bg)",
                    borderRadius: 8,
                  }}
                >
                  Try Encrypted Payroll <ArrowRight size={14} />
                </Link>
                <Link
                  href="/auctions"
                  className="inline-flex items-center gap-2 px-3 py-3 text-sm font-medium transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  Run a sealed auction <ArrowRight size={14} />
                </Link>
                <FaucetButton />
              </>
            )}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ THE PROBLEM ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — The problem
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.08] mb-6 max-w-3xl"
            style={{ fontSize: "clamp(30px, 3.6vw, 46px)", letterSpacing: "-0.03em" }}
          >
            On public chains, every number is{" "}
            <em className="font-serif italic font-normal">exposed</em>.
          </h2>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(16px, 1.3vw, 18px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            MEV bots extract <span style={{ color: "var(--text)", fontWeight: 600 }}>$500M+</span>{" "}
            annually by front-running trades. Auction bids are visible, enabling
            sniping. Portfolio values are public, making holders targets.
            Salaries, vendor payments, treasury moves — all readable by anyone
            with a block explorer.
          </p>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ FOUR CAPABILITIES ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Four capabilities
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.08] mb-12 max-w-3xl"
            style={{ fontSize: "clamp(30px, 3.6vw, 46px)", letterSpacing: "-0.03em" }}
          >
            One protocol.{" "}
            <em className="font-serif italic font-normal">Four primitives</em>.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {CAPABILITIES.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className="group block p-7 transition-colors"
                style={{
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <div className="flex items-start justify-between mb-6">
                  <div
                    className="font-mono text-[11px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {f.subtitle}
                  </div>
                  <f.icon size={18} style={{ color: "var(--text-muted)" }} />
                </div>
                <h3
                  className="font-display text-2xl font-semibold mb-3"
                  style={{ letterSpacing: "-0.02em", color: "var(--text)" }}
                >
                  {f.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {f.description}
                </p>
                <div
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: "var(--text)" }}
                >
                  Open <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ HOW FHE WORKS ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — How FHE works
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.08] mb-12 max-w-3xl"
            style={{ fontSize: "clamp(30px, 3.6vw, 46px)", letterSpacing: "-0.03em" }}
          >
            Compute on ciphertext.{" "}
            <em className="font-serif italic font-normal">Reveal nothing</em>.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
            {[
              {
                step: "01",
                title: "Encrypt client-side",
                desc: "Your values are encrypted via @cofhe/sdk before leaving your browser. A ZK proof guarantees validity without revealing the plaintext.",
              },
              {
                step: "02",
                title: "Compute on ciphertext",
                desc: "Smart contracts run FHE operations (add, compare, select) directly on encrypted data. Values never decrypt on-chain.",
              },
              {
                step: "03",
                title: "Unseal selectively",
                desc: "Only authorized parties decrypt via cryptographic permits. The chain stores hashes. Validators see noise. You see truth.",
              },
            ].map((s) => (
              <div key={s.step} className="space-y-3">
                <div
                  className="font-mono text-xs tracking-[0.1em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.step}
                </div>
                <h3
                  className="font-display text-lg font-semibold"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  {s.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 15 }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ INNOVATION ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Innovation
          </div>
          <h2
            className="font-display font-bold tracking-tight leading-[1.08] mb-12 max-w-3xl"
            style={{ fontSize: "clamp(30px, 3.6vw, 46px)", letterSpacing: "-0.03em" }}
          >
            What only{" "}
            <em className="font-serif italic font-normal">FHE</em> makes possible.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {INNOVATIONS.map((inn) => (
              <div
                key={inn.title}
                className="p-7"
                style={{
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <inn.icon size={20} style={{ color: "var(--text-muted)" }} />
                <h3
                  className="font-display text-lg font-semibold mt-5 mb-3"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  {inn.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 14 }}>
                  {inn.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ PRIVACY STAGES ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Privacy roadmap
          </div>
          <PrivacyStages />
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ TREASURY FLOW ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Composability
          </div>
          <TreasuryFlow />
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ LIVE ACTIVITY ═══════ */}
        <section>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em] mb-7"
            style={{ color: "var(--text-muted)" }}
          >
            — Live on chain
          </div>
          <ActivityFeed
            variant="grid"
            title="Counts only — amounts encrypted"
          />
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* ═══════ STATS ═══════ */}
        <section>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { label: "FHE operations", value: "22+" },
              { label: "Smart contracts", value: "20" },
              { label: "Auction types", value: "5" },
              { label: "Hero flows", value: "4" },
            ].map((s) => (
              <div
                key={s.label}
                className="p-7"
                style={{
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <p
                  className="font-display text-4xl font-bold"
                  style={{ letterSpacing: "-0.03em", color: "var(--text)" }}
                >
                  {s.value}
                </p>
                <p
                  className="font-mono text-[11px] uppercase tracking-[0.1em] mt-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════ FOOTER MARK ═══════ */}
        <div
          className="flex items-center justify-between pt-8 font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{
            borderTop: "1px dashed var(--border-dash)",
            color: "var(--text-muted)",
          }}
        >
          <span>Zerith · Built on Fhenix CoFHE</span>
          <span>Arbitrum Sepolia · 421614</span>
        </div>
      </div>
    </div>
  );
}
