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
 * Treasury Flow — visualizes the architectural moat.
 *
 * One deposit. Four flows. Zero plaintext touchpoints in transit.
 *
 * This diagram is the entire defensibility story made visible. While other FHE
 * protocols encrypt one feature, Sigil composes encrypted state across an
 * entire ops stack — auctions, payments, trade, hire — all settling through
 * one encrypted vault.
 *
 * Hover any flow to highlight that path.
 */

type FlowKey = "launch" | "pay" | "trade" | "hire" | null;

interface FlowDef {
  key: NonNullable<FlowKey>;
  label: string;
  desc: string;
  icon: typeof Rocket;
  color: string;
  bgColor: string;
  borderColor: string;
  outcome: string;
}

const FLOWS: FlowDef[] = [
  {
    key: "launch",
    label: "Launch",
    desc: "Sealed-bid token auctions",
    icon: Rocket,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    outcome: "Tokens won, paid in encrypted bid",
  },
  {
    key: "pay",
    label: "Pay",
    desc: "Encrypted multi-recipient splits & streams",
    icon: CreditCard,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    outcome: "Contributors paid, amounts hidden",
  },
  {
    key: "trade",
    label: "Trade",
    desc: "Private OTC + limit orders",
    icon: ArrowLeftRight,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    outcome: "Trade settled, position size private",
  },
  {
    key: "hire",
    label: "Hire",
    desc: "Blind-bid freelance with milestones",
    icon: Briefcase,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    outcome: "Freelancer paid, budget never leaks",
  },
];

export function TreasuryFlow() {
  const [active, setActive] = useState<FlowKey>(null);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--void-2)]/30 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Lock size={16} className="text-[var(--cipher-violet)]" />
        <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-[0.15em]">
          One Vault. Four Flows. Zero Leaks.
        </h2>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-8 max-w-2xl">
        Every operation settles through one shared encrypted vault. A deposit
        can flow through launches, payments, trades, and hires —
        <span className="text-[var(--text-primary)] font-medium">
          {" "}
          never touching plaintext in transit.
        </span>{" "}
        That&apos;s the architectural moat no fork can copy in a weekend.
      </p>

      {/* Diagram */}
      <div className="relative">
        {/* Source: encrypted deposit */}
        <div className="flex justify-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex items-center gap-3 px-5 py-3 rounded-xl
                       bg-[var(--cipher-violet)]/10 border border-[var(--cipher-violet)]/30
                       shadow-lg shadow-[var(--cipher-violet)]/10"
          >
            <Wallet size={18} className="text-[var(--cipher-violet)]" />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--cipher-violet)] font-bold">
                Source
              </p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Encrypted Deposit
              </p>
            </div>
            <span className="ml-2 text-[10px] font-mono text-[var(--cipher-violet)] bg-[var(--cipher-violet)]/15 px-2 py-0.5 rounded">
              euint64
            </span>
          </motion.div>
        </div>

        {/* SVG paths (decorative connectors) */}
        <svg
          className="absolute left-0 right-0 top-[68px] h-12 w-full pointer-events-none"
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* 4 paths fanning out to the 4 flow cards */}
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
              className={`transition-colors duration-300 ${
                active && active !== FLOWS[i].key
                  ? "text-white/5"
                  : "text-[var(--cipher-violet)]/40"
              }`}
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
                className={`relative rounded-lg p-4 border cursor-pointer transition-all duration-300
                  ${isActive ? `${flow.bgColor} ${flow.borderColor} scale-[1.02]` : ""}
                  ${isDimmed ? "opacity-40 border-white/5 bg-white/[0.01]" : ""}
                  ${!active ? "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]" : ""}
                  focus:outline-none focus:ring-2 focus:ring-[var(--cipher-violet)]/40`}
                role="button"
                aria-label={`${flow.label} flow: ${flow.desc}`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3
                  ${flow.bgColor} ${flow.borderColor} border`}
                >
                  <flow.icon size={16} className={flow.color} />
                </div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] mb-0.5">
                  {flow.label}
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-2">
                  {flow.desc}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-emerald-400/80 font-medium">
                  <Lock size={9} />
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
          className="mt-8 flex items-center justify-center gap-2"
        >
          <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent via-emerald-500/40 to-emerald-500/40" />
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-lg
                          bg-emerald-500/10 border border-emerald-500/25
                          shadow-lg shadow-emerald-500/5">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">
              {active
                ? FLOWS.find((f) => f.key === active)?.outcome
                : "Settled in vault — still encrypted"}
            </span>
          </div>
          <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent via-emerald-500/40 to-emerald-500/40" />
        </motion.div>
      </div>

      {/* Tip */}
      <p className="text-[11px] text-[var(--text-muted)] text-center mt-5 italic">
        Hover any flow to follow the encrypted path.
      </p>
    </section>
  );
}
