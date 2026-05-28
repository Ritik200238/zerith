"use client";

export const dynamic = "force-dynamic";

/**
 * Contact + FAQ — /contact
 *
 * The "how do I actually reach a human at Zerith" page. Three asks:
 *   1. Direct email — for foundation BD / press / security disclosures
 *   2. Cal.com booking — 30 min slot for foundations exploring a pilot
 *   3. Twitter / GitHub — for everyone else
 *
 * Below: a curated FAQ that answers the questions a foundation
 * finance lead asks before they email. Editorial style — dashed
 * sections, em-dash kicker, italic-serif accents.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  Calendar,
  Github,
  ArrowRight,
  ChevronDown,
  Lock,
  Shield,
  Coins,
  Network,
  AlertTriangle,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

/* ─── Channels ───────────────────────────────────────────── */

interface Channel {
  Icon: LucideIcon;
  label: string;
  description: string;
  href: string;
  cta: string;
  primary?: boolean;
}

const CHANNELS: Channel[] = [
  {
    Icon: Calendar,
    label: "Book a 30-min call",
    description:
      "Foundation pilot inquiries, design partnerships, integration questions. We will show you a live encrypted auction on your own asset shape.",
    href: "https://cal.com/zerith/30min",
    cta: "Schedule",
    primary: true,
  },
  {
    Icon: Mail,
    label: "Email",
    description:
      "BD, press, partnership, and general inquiries. We answer every email within 24 hours during weekdays.",
    href: "mailto:hello@zerith.fi",
    cta: "hello@zerith.fi",
  },
  {
    Icon: Shield,
    label: "Security disclosure",
    description:
      "Found a vulnerability? Please disclose it privately first. We will acknowledge within 24 hours and coordinate the fix + public credit.",
    href: "mailto:security@zerith.fi",
    cta: "security@zerith.fi",
  },
  {
    Icon: Github,
    label: "GitHub Issues",
    description:
      "Bug reports, feature requests, and contributor discussion. Public and welcome.",
    href: "https://github.com/Ritik200238/zerith/issues",
    cta: "Open an issue",
  },
];

/* ─── FAQ entries ────────────────────────────────────────── */

interface FaqEntry {
  Icon: LucideIcon;
  question: string;
  answer: React.ReactNode;
}

const FAQS: FaqEntry[] = [
  {
    Icon: HelpCircle,
    question: "What is Zerith, in one sentence?",
    answer: (
      <>
        Zerith is an encrypted block-sale protocol for token foundations:
        bidders submit sealed prices, the chain runs the auction on
        ciphertext via Fhenix FHE, and only the winner is revealed —
        every losing bid stays encrypted on Ethereum forever.
      </>
    ),
  },
  {
    Icon: Lock,
    question: "What does 'fully homomorphic encryption' actually do here?",
    answer: (
      <>
        FHE lets a smart contract compute on encrypted values without
        decrypting them. We use it for <code>FHE.gt</code>,{" "}
        <code>FHE.max</code>, <code>FHE.select</code>, and{" "}
        <code>FHE.add</code> over encrypted bids. The chain never sees
        plaintext. Only a Threshold Network of independent operators can
        co-sign a decryption — and only of the winner, never the losers.
      </>
    ),
  },
  {
    Icon: Network,
    question: "Are you on mainnet?",
    answer: (
      <>
        Not yet. The protocol is live on Ethereum Sepolia today with 26
        deployed contracts and verified end-to-end transactions. Mainnet
        (Arbitrum) is gated on a formal security audit and migration to
        a Safe multisig — both tracked publicly in our launch sequence.
      </>
    ),
  },
  {
    Icon: Shield,
    question: "Has Zerith been audited?",
    answer: (
      <>
        Not yet by an external firm. Internally we have 40+ Hardhat unit
        tests, 34 verified Sepolia transactions, and a public privacy-audit
        page (<Link href="/audit" className="underline">/audit</Link>) that
        opens the schema for every contract. A formal audit is the gating
        item for our mainnet launch and will be commissioned with one of
        Spearbit, Zellic, ChainSecurity, or Trail of Bits.
      </>
    ),
  },
  {
    Icon: Coins,
    question: "What does it cost?",
    answer: (
      <>
        Today: nothing — it's a public testnet protocol. At general
        availability we will charge a small basis-point fee on settled
        notional, with a discounted pilot rate for design partners. We
        will publish exact pricing on the <code>/pricing</code> page
        before mainnet launch.
      </>
    ),
  },
  {
    Icon: Lock,
    question: "Can foundations bid in stablecoins?",
    answer: (
      <>
        Stablecoin (USDC) settlement is on the v1.1 roadmap and is
        prerequisite to any real foundation pilot. The settlement-token
        whitelist already exists in the contract — adding USDC is a
        per-deployment switch, not a new protocol.
      </>
    ),
  },
  {
    Icon: Shield,
    question: "Who controls the protocol contracts today?",
    answer: (
      <>
        Single deployer EOA on Sepolia today. Pre-mainnet we move ownership
        to a 2-of-3 Safe multisig. Pause and emergency guardrails are in
        place via the <code>PlatformRegistry</code> contract.
      </>
    ),
  },
  {
    Icon: Network,
    question: "Why does the on-chain symbol say 'CDEX' instead of Zerith?",
    answer: (
      <>
        The settlement token was deployed under the project's previous name.
        ERC-20 metadata is immutable, so the on-chain symbol stays{" "}
        <code>CDEX</code>. The UI brand is Zerith. Full explainer:{" "}
        <Link href="/why-cdex" className="underline">
          /why-cdex
        </Link>
        .
      </>
    ),
  },
  {
    Icon: HelpCircle,
    question: "Why does an encrypted bid take 15–40 seconds to confirm?",
    answer: (
      <>
        Three real cryptographic steps: client-side encryption (WASM,
        2–5s), threshold-network co-sign (3–10s), and Ethereum L1
        confirmation (10–25s). The TxFlowDrawer narrates each step so
        the latency feels intentional. The wait is the privacy.
      </>
    ),
  },
  {
    Icon: HelpCircle,
    question: "Can I integrate Zerith into our existing treasury workflow?",
    answer: (
      <>
        Yes. We ship a typed TypeScript SDK and Hardhat task runners for
        scripted use, and the contracts are unowned at the user level —
        a foundation can post auctions and accept bids permissionlessly
        from any wallet they choose. For high-volume integrations,
        please book a call.
      </>
    ),
  },
  {
    Icon: AlertTriangle,
    question: "What happens if the threshold network is down?",
    answer: (
      <>
        Encrypted submissions still confirm on-chain — the FHE network
        only co-signs decryption-on-reveal, not the encrypted writes.
        Reveals can be retried. Each auction has a 7-day emergency
        timeout that allows seller cancellation if reveal cannot complete.
      </>
    ),
  },
  {
    Icon: HelpCircle,
    question: "Can I run my own Zerith deployment?",
    answer: (
      <>
        Yes. The repository is open source under MIT (we are evaluating a
        switch to Apache 2.0 for stronger patent protection). All 26
        contracts deploy cleanly via{" "}
        <code>npm run deploy:sepolia</code> or the equivalent for Arbitrum
        Sepolia. See the README for the full reproduction path.
      </>
    ),
  },
];

/* ─── Page ───────────────────────────────────────────────── */

export default function ContactPage() {
  return (
    <div
      className="font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1080px] px-5 md:px-10 py-16 md:py-24 space-y-20">
        {/* HERO */}
        <header className="space-y-6">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Contact
          </div>
          <h1
            className="font-display font-bold tracking-tight leading-[1.04]"
            style={{
              fontSize: "clamp(38px, 5.4vw, 68px)",
              letterSpacing: "-0.04em",
            }}
          >
            Talk to a{" "}
            <em className="font-serif italic font-normal">human</em>.
          </h1>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(15px, 1.2vw, 17px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            Foundations exploring an encrypted block sale, market makers
            asking integration questions, security researchers, journalists —
            the channels below all reach a real person, not a router. We
            answer everything personally within 24 hours on weekdays.
          </p>
        </header>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* CHANNELS */}
        <section className="space-y-8">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Channels
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {CHANNELS.map((c) => (
              <ChannelCard key={c.label} channel={c} />
            ))}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* FAQ */}
        <section className="space-y-8">
          <div className="space-y-4">
            <div
              className="font-mono text-[11px] uppercase tracking-[0.1em]"
              style={{ color: "var(--text-muted)" }}
            >
              — FAQ
            </div>
            <h2
              className="font-display font-bold tracking-tight leading-[1.08] max-w-3xl"
              style={{
                fontSize: "clamp(28px, 3.4vw, 42px)",
                letterSpacing: "-0.03em",
              }}
            >
              Questions a foundation lead asks{" "}
              <em className="font-serif italic font-normal">before</em>{" "}
              they email.
            </h2>
            <p
              className="max-w-2xl"
              style={{
                color: "var(--text-secondary)",
                fontSize: 15.5,
                lineHeight: 1.7,
              }}
            >
              These are the real questions we hear. If yours isn&apos;t
              listed, the channels above route to a person who can answer.
            </p>
          </div>
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px dashed var(--border-dash)",
              borderRadius: 4,
            }}
            className="overflow-hidden"
          >
            {FAQS.map((entry, i) => (
              <FaqRow key={i} entry={entry} isLast={i === FAQS.length - 1} />
            ))}
          </div>
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* CTA */}
        <footer className="space-y-6">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Still curious
          </div>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(17px, 1.6vw, 22px)",
              lineHeight: 1.5,
              color: "var(--text)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Open the live app, click <em className="font-serif italic font-normal">Try Instantly</em>,
            and run a real encrypted auction in five seconds — no MetaMask required.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderRadius: 8,
              }}
            >
              Open the app <ArrowRight size={14} />
            </Link>
            <Link
              href="/auctions"
              className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              See block sales <ArrowRight size={14} />
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────── */

function ChannelCard({ channel }: { channel: Channel }) {
  const { Icon } = channel;
  const isExternal = channel.href.startsWith("http");
  const target = isExternal ? "_blank" : undefined;
  const rel = isExternal ? "noopener noreferrer" : undefined;
  return (
    <a
      href={channel.href}
      target={target}
      rel={rel}
      className="group block p-7 transition-colors"
      style={{
        background: channel.primary ? "var(--text)" : "var(--bg-card)",
        color: channel.primary ? "var(--bg)" : "var(--text)",
        border: channel.primary
          ? "1px solid var(--text)"
          : "1px dashed var(--border-dash)",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        if (!channel.primary) {
          e.currentTarget.style.borderColor = "var(--text-muted)";
          e.currentTarget.style.background = "var(--bg-card-hover)";
        }
      }}
      onMouseLeave={(e) => {
        if (!channel.primary) {
          e.currentTarget.style.borderColor = "var(--border-dash)";
          e.currentTarget.style.background = "var(--bg-card)";
        }
      }}
    >
      <div className="flex items-start justify-between mb-5">
        <div
          className="w-10 h-10 flex items-center justify-center"
          style={{
            background: channel.primary
              ? "rgba(250, 250, 247, 0.12)"
              : "var(--bg-alt)",
            border: `1px dashed ${
              channel.primary ? "rgba(250, 250, 247, 0.30)" : "var(--border-dash)"
            }`,
            borderRadius: 4,
          }}
        >
          <Icon size={16} />
        </div>
        <ArrowRight
          size={16}
          className="transition-transform group-hover:translate-x-0.5"
          style={{
            color: channel.primary ? "var(--bg)" : "var(--text-muted)",
            opacity: 0.7,
          }}
        />
      </div>
      <h3
        className="font-display font-semibold mb-2"
        style={{
          fontSize: 18,
          letterSpacing: "-0.015em",
        }}
      >
        {channel.label}
      </h3>
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.6,
          color: channel.primary
            ? "rgba(250, 250, 247, 0.78)"
            : "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        {channel.description}
      </p>
      <div
        className="font-mono text-[11px] uppercase tracking-[0.1em]"
        style={{
          color: channel.primary
            ? "rgba(250, 250, 247, 0.78)"
            : "var(--text)",
          fontWeight: 600,
        }}
      >
        {channel.cta}
      </div>
    </a>
  );
}

function FaqRow({ entry, isLast }: { entry: FaqEntry; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const { Icon } = entry;
  return (
    <div
      style={
        isLast
          ? undefined
          : { borderBottom: "1px dashed var(--border-dash)" }
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-4 px-6 py-5 text-left transition-colors"
        style={{ color: "var(--text)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-card-hover)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
      >
        <span
          className="shrink-0 w-8 h-8 flex items-center justify-center"
          style={{
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
            background: "var(--bg-alt)",
          }}
        >
          <Icon size={14} style={{ color: "var(--text)" }} />
        </span>
        <span
          className="flex-1 font-display font-semibold"
          style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}
        >
          {entry.question}
        </span>
        <ChevronDown
          size={16}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 200ms ease",
          }}
        />
      </button>
      {open && (
        <div
          className="px-6 pb-6 pt-0 pl-[72px]"
          style={{
            color: "var(--text-secondary)",
            fontSize: 14.5,
            lineHeight: 1.7,
          }}
        >
          {entry.answer}
        </div>
      )}
    </div>
  );
}
