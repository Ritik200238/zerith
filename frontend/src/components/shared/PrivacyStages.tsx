"use client";

import { motion } from "framer-motion";
import { Box, Lock, ShieldCheck, ArrowRight } from "lucide-react";

/**
 * Privacy Stages — public taxonomy showing where we are on the privacy journey.
 *
 * Based on Fhenix's Jan 2026 framework: a 3-tier ladder of cryptographic guarantees.
 * Stage 0 = TEE-only (trust the box). Stage 1 = pure FHE crypto, where we live now.
 * Stage 2 = DKG + permissionless operators + defense-in-depth (the future).
 *
 * Why it's on the landing: investors and judges read about Privacy Stages in
 * Fhenix's blog. Showing exactly where we sit + where we're going builds credibility
 * faster than any marketing copy can.
 */

interface Stage {
  id: 0 | 1 | 2;
  title: string;
  subtitle: string;
  description: string;
  example: string;
  icon: typeof Box;
  status: "past" | "current" | "future";
}

const STAGES: Stage[] = [
  {
    id: 0,
    title: "Stage 0",
    subtitle: "Trust the Box",
    description:
      "Privacy depends on hardware enclaves (TEEs). Fast — but if the box is compromised, every secret leaks at once.",
    example: "Most current 'private' L2s sit here.",
    icon: Box,
    status: "past",
  },
  {
    id: 1,
    title: "Stage 1",
    subtitle: "Pure Cryptography",
    description:
      "Math, not hardware. Smart contracts compute directly on encrypted data with FHE. No TEE, no single trusted party.",
    example: "CipherDEX is here today, powered by Fhenix CoFHE.",
    icon: Lock,
    status: "current",
  },
  {
    id: 2,
    title: "Stage 2",
    subtitle: "Defense in Depth",
    description:
      "Distributed key generation, permissionless operators, optional TEEs, economic incentives. Privacy survives partial compromise.",
    example: "Where CipherDEX is heading as Fhenix's threshold network matures.",
    icon: ShieldCheck,
    status: "future",
  },
];

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const isCurrent = stage.status === "current";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
      className={`relative overflow-hidden rounded-xl border p-6 space-y-4 transition-all
        ${isCurrent
          ? "border-emerald-500/30 bg-emerald-500/[0.03] shadow-lg shadow-emerald-500/5"
          : "border-[var(--border-subtle)] bg-[var(--void-2)]/40"
        }`}
    >
      {/* Pulse for current stage */}
      {isCurrent && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
            You are here
          </span>
        </div>
      )}

      {/* Icon + label */}
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0
          ${isCurrent
            ? "bg-emerald-500/20 border border-emerald-500/30"
            : "bg-white/[0.03] border border-white/5"
          }`}
        >
          <stage.icon
            size={18}
            className={isCurrent ? "text-emerald-400" : "text-gray-500"}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={`text-[10px] font-bold uppercase tracking-[0.15em] mb-0.5
            ${isCurrent ? "text-emerald-400" : "text-gray-500"}`}
          >
            {stage.title}
          </p>
          <h3 className="text-base font-bold text-[var(--text-primary)]">
            {stage.subtitle}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
        {stage.description}
      </p>

      {/* Example chip */}
      <div
        className={`text-[11px] leading-relaxed px-3 py-2 rounded-md border
        ${isCurrent
          ? "border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-200/90"
          : "border-white/5 bg-white/[0.02] text-gray-400"
        }`}
      >
        {stage.example}
      </div>
    </motion.div>
  );
}

export function PrivacyStages() {
  return (
    <section
      id="privacy-stages"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--void-2)]/20 p-6 md:p-8"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-[0.15em]">
          Privacy Stages
        </h2>
        <a
          href="https://www.fhenix.io/blog/the-different-stages-of-privacy-a-taxonomy"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
        >
          Read the framework <ArrowRight size={11} />
        </a>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6 max-w-2xl">
        How private is &quot;private&quot;? Fhenix&apos;s public framework grades blockchain
        privacy on a 3-tier ladder. We show you exactly where CipherDEX sits — and
        where we&apos;re heading.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STAGES.map((stage, i) => (
          <StageCard key={stage.id} stage={stage} index={i} />
        ))}
      </div>
    </section>
  );
}
