"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  Rocket,
  CreditCard,
  ArrowLeftRight,
  Briefcase,
  Lock,
  CheckCircle2,
} from "lucide-react";

/**
 * One vault. Four flows. Zero plaintext touchpoints in transit.
 *
 * Every operation settles through one shared encrypted vault — auctions,
 * payments, trade, hire — never decrypting in between. Hover any flow
 * to follow that path.
 */

type FlowKey = "launch" | "pay" | "trade" | "hire" | null;

interface FlowDef {
  key: NonNullable<FlowKey>;
  label: string;
  desc: string;
  icon: typeof Rocket;
  outcome: string;
}

const FLOWS: FlowDef[] = [
  {
    key: "launch",
    label: "Launch",
    desc: "Sealed-bid token auctions",
    icon: Rocket,
    outcome: "Tokens won, paid in encrypted bid",
  },
  {
    key: "pay",
    label: "Pay",
    desc: "Encrypted multi-recipient splits & streams",
    icon: CreditCard,
    outcome: "Contributors paid, amounts hidden",
  },
  {
    key: "trade",
    label: "Trade",
    desc: "Private OTC + limit orders",
    icon: ArrowLeftRight,
    outcome: "Trade settled, position size private",
  },
  {
    key: "hire",
    label: "Hire",
    desc: "Blind-bid freelance with milestones",
    icon: Briefcase,
    outcome: "Freelancer paid, budget never leaks",
  },
];

export function TreasuryFlow() {
  const [active, setActive] = useState<FlowKey>(null);

  return (
    <section
      className="p-6 md:p-8"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Lock size={14} style={{ color: "var(--text-muted)" }} />
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          One vault · Four flows · Zero leaks
        </span>
      </div>
      <h2
        className="font-display font-bold mb-4"
        style={{
          fontSize: "clamp(24px, 2.4vw, 32px)",
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          color: "var(--text)",
        }}
      >
        Compose encrypted ops across the{" "}
        <em className="font-serif italic font-normal">whole stack</em>.
      </h2>
      <p
        className="max-w-2xl mb-10"
        style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.65 }}
      >
        Every operation settles through one shared encrypted vault. A deposit
        can flow through launches, payments, trades, and hires —
        <strong style={{ color: "var(--text)", fontWeight: 600 }}>
          {" "}
          never touching plaintext in transit.
        </strong>{" "}
        That&apos;s the architectural moat no fork can copy in a weekend.
      </p>

      {/* Diagram */}
      <div className="relative">
        {/* Source: encrypted deposit */}
        <div className="flex justify-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex items-center gap-3 px-4 py-3"
            style={{
              background: "var(--bg-alt)",
              border: "1px dashed var(--border-dash)",
              borderRadius: "var(--radius)",
            }}
          >
            <Wallet size={16} style={{ color: "var(--text)" }} />
            <div>
              <p
                className="font-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Source
              </p>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Encrypted Deposit
              </p>
            </div>
            <span
              className="ml-2 font-mono px-2 py-0.5"
              style={{
                fontSize: 10,
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
              }}
            >
              euint64
            </span>
          </motion.div>
        </div>

        {/* SVG connectors — neutral dashed lines */}
        <svg
          className="absolute left-0 right-0 top-[68px] h-12 w-full pointer-events-none"
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[12.5, 37.5, 62.5, 87.5].map((x, i) => (
            <motion.line
              key={i}
              x1="50"
              y1="0"
              x2={x}
              y2="12"
              stroke="currentColor"
              strokeWidth="0.2"
              strokeDasharray="0.8 0.6"
              style={{
                color: active && active !== FLOWS[i].key ? "var(--border)" : "var(--border-dash)",
                opacity: active && active !== FLOWS[i].key ? 0.3 : 1,
                transition: "opacity 0.3s var(--ease), color 0.3s var(--ease)",
              }}
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.6 }}
            />
          ))}
        </svg>

        {/* 4 flow cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {FLOWS.map((flow, i) => {
            const isActive = active === flow.key;
            const isDimmed = active && !isActive;

            return (
              <motion.div
                key={flow.key}
                onMouseEnter={() => setActive(flow.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(flow.key)}
                onBlur={() => setActive(null)}
                tabIndex={0}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.4 }}
                className="relative p-4 cursor-pointer focus:outline-none"
                style={{
                  background: isActive ? "var(--bg-card-hover)" : "var(--bg-card)",
                  border: "1px dashed",
                  borderColor: isActive ? "var(--text-muted)" : "var(--border-dash)",
                  borderRadius: "var(--radius)",
                  opacity: isDimmed ? 0.5 : 1,
                  transform: isActive ? "scale(1.015)" : "scale(1)",
                  transition: "all 0.3s var(--ease)",
                }}
                role="button"
                aria-label={`${flow.label} flow: ${flow.desc}`}
              >
                <div
                  className="flex items-center justify-center mb-3"
                  style={{
                    width: 32,
                    height: 32,
                    background: "var(--bg-alt)",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <flow.icon size={14} style={{ color: "var(--text)" }} />
                </div>
                <h3
                  className="font-display font-semibold mb-1"
                  style={{ fontSize: 14, color: "var(--text)", letterSpacing: "-0.01em" }}
                >
                  {flow.label}
                </h3>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    lineHeight: 1.55,
                    marginBottom: 10,
                  }}
                >
                  {flow.desc}
                </p>
                <div
                  className="flex items-center gap-1 font-mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  <Lock size={8} />
                  Encrypted in transit
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Outcome strip */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.8 }}
          className="mt-8 flex items-center justify-center gap-3"
        >
          <hr style={{ flex: 1, maxWidth: 80, border: "none", borderTop: "1px dashed var(--border-dash)" }} />
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{
              background: "var(--success-bg)",
              border: "1px dashed var(--border-dash)",
              borderRadius: "var(--radius)",
            }}
          >
            <CheckCircle2 size={12} style={{ color: "var(--success)" }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
              {active
                ? FLOWS.find((f) => f.key === active)?.outcome
                : "Settled in vault — still encrypted"}
            </span>
          </div>
          <hr style={{ flex: 1, maxWidth: 80, border: "none", borderTop: "1px dashed var(--border-dash)" }} />
        </motion.div>
      </div>

      {/* Tip */}
      <p
        className="text-center mt-5 font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        Hover any flow to follow the encrypted path
      </p>
    </section>
  );
}
