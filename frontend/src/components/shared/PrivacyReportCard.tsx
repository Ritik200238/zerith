"use client";

import { Lock, Eye, AlertTriangle, Info } from "lucide-react";
import { useState } from "react";

/**
 * Privacy Report Card — per-feature transparency card.
 *
 * Goes at the top of every feature page. Shows in 3 seconds:
 * - 🟢 What's encrypted (the privacy guarantee)
 * - 🟡 What's visible on-chain (timing, counts — never amounts)
 * - 🔴 What leaks (= ideally nothing)
 * - The actual FHE operations the contract runs
 *
 * Why it matters: every other privacy product describes its guarantees in
 * marketing copy. We surface them at the point of use, with the actual ops.
 * Users can verify our claims directly against the contract.
 */

export interface PrivacyReport {
  encrypted: string[];
  visible: string[];
  leaks: string[];
  fheOps: string[];
}

interface Props {
  feature: string;
  report: PrivacyReport;
  contractAddress?: string;
  explorerUrl?: string;
}

function Section({
  icon: Icon,
  color,
  bgColor,
  borderColor,
  label,
  items,
  emptyText,
}: {
  icon: typeof Lock;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  items: string[];
  emptyText?: string;
}) {
  if (items.length === 0 && !emptyText) return null;

  return (
    <div className={`rounded-lg p-3.5 border ${borderColor} ${bgColor}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} className={color} />
        <p className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>
          {label}
        </p>
      </div>
      <ul className="space-y-1.5">
        {items.length === 0 ? (
          <li className="text-[12px] text-gray-400 italic leading-relaxed">
            {emptyText}
          </li>
        ) : (
          items.map((item, i) => (
            <li
              key={i}
              className="text-[12px] text-[var(--text-secondary)] leading-relaxed flex gap-1.5"
            >
              <span className={`${color} shrink-0 mt-1`}>•</span>
              <span>{item}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function PrivacyReportCard({ feature, report, contractAddress, explorerUrl }: Props) {
  const [showOps, setShowOps] = useState(false);

  return (
    <section
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--void-2)]/40 p-5"
      aria-label={`Privacy report for ${feature}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
            <Lock size={14} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Privacy Report
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              How {feature} keeps your data confidential
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOps(!showOps)}
            className="text-[11px] text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline transition"
          >
            {showOps ? "Hide" : "Show"} FHE ops
          </button>
          {contractAddress && explorerUrl && (
            <a
              href={`${explorerUrl}/address/${contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-400 hover:text-blue-300 transition"
            >
              View contract →
            </a>
          )}
        </div>
      </div>

      {/* 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Section
          icon={Lock}
          color="text-emerald-400"
          bgColor="bg-emerald-500/[0.04]"
          borderColor="border-emerald-500/15"
          label="Encrypted"
          items={report.encrypted}
        />
        <Section
          icon={Eye}
          color="text-amber-400"
          bgColor="bg-amber-500/[0.04]"
          borderColor="border-amber-500/15"
          label="Visible on-chain"
          items={report.visible}
          emptyText="Nothing visible — fully private"
        />
        <Section
          icon={AlertTriangle}
          color="text-red-400"
          bgColor="bg-red-500/[0.04]"
          borderColor="border-red-500/15"
          label="What leaks"
          items={report.leaks}
          emptyText="Nothing leaks 🛡️"
        />
      </div>

      {/* FHE ops drawer (collapsed by default) */}
      {showOps && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
          <div className="flex items-center gap-1.5 mb-2">
            <Info size={12} className="text-[var(--cipher-violet)]" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--cipher-violet)]">
              FHE Operations Used
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.fheOps.map((op) => (
              <code
                key={op}
                className="text-[11px] px-2 py-0.5 rounded bg-[var(--cipher-violet)]/10
                           border border-[var(--cipher-violet)]/20
                           text-[var(--cipher-violet)] font-mono"
              >
                FHE.{op}
              </code>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
            These run on encrypted data. The contract never sees plaintext values
            until a verified reveal (if any).
          </p>
        </div>
      )}
    </section>
  );
}
