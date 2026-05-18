"use client";

import { motion } from "framer-motion";
import { Box, Lock, ShieldCheck, ArrowRight } from "lucide-react";

/**
 * Privacy Stages — Fhenix's Jan 2026 framework: TEE → pure FHE → DKG +
 * permissionless operators. Shows exactly where we sit and where we're going.
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
    example: "Zerith is here today, powered by Fhenix CoFHE.",
    icon: Lock,
    status: "current",
  },
  {
    id: 2,
    title: "Stage 2",
    subtitle: "Defense in Depth",
    description:
      "Distributed key generation, permissionless operators, optional TEEs, economic incentives. Privacy survives partial compromise.",
    example: "Where Zerith is heading as Fhenix's threshold network matures.",
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
      className="relative overflow-hidden p-6 space-y-4"
      style={{
        background: isCurrent ? "var(--bg-card-hover)" : "var(--bg-card)",
        border: "1px dashed",
        borderColor: isCurrent ? "var(--text-muted)" : "var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
    >
      {/* "You are here" mark for current stage */}
      {isCurrent && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ background: "var(--success)" }}
            />
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ background: "var(--success)" }}
            />
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            You are here
          </span>
        </div>
      )}

      {/* Icon + label */}
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            background: "var(--bg-alt)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
          }}
        >
          <stage.icon size={16} style={{ color: "var(--text)" }} />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="font-mono mb-0.5"
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            <span style={{ opacity: 0.5 }}>— </span>
            {stage.title}
          </p>
          <h3
            className="font-display font-semibold"
            style={{ fontSize: 16, color: "var(--text)", letterSpacing: "-0.015em" }}
          >
            {stage.subtitle}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {stage.description}
      </p>

      {/* Example chip */}
      <div
        className="px-3 py-2"
        style={{
          fontSize: 11,
          lineHeight: 1.55,
          color: isCurrent ? "var(--text-secondary)" : "var(--text-muted)",
          background: "var(--bg-alt)",
          border: "1px dashed var(--border-dash)",
          borderRadius: "var(--radius)",
        }}
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
      className="p-6 md:p-8"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ opacity: 0.5 }}>— </span>
          Privacy Stages
        </span>
        <a
          href="https://www.fhenix.io/blog/the-different-stages-of-privacy-a-taxonomy"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1 font-mono transition-colors"
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          Read the framework <ArrowRight size={11} />
        </a>
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
        How <em className="font-serif italic font-normal">private</em> is
        &quot;private&quot;?
      </h2>
      <p
        className="max-w-2xl mb-8"
        style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.65 }}
      >
        Fhenix&apos;s public framework grades blockchain privacy on a 3-tier ladder.
        We show you exactly where Zerith sits — and where we&apos;re heading.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STAGES.map((stage, i) => (
          <StageCard key={stage.id} stage={stage} index={i} />
        ))}
      </div>
    </section>
  );
}
