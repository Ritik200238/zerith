"use client";

import { Lock, Eye, AlertTriangle, Info } from "lucide-react";
import { useState } from "react";

/**
 * Privacy Report Card — per-feature transparency card.
 *
 * Goes at the top of every feature page. Shows in 3 seconds:
 *  - What's encrypted (the privacy guarantee)
 *  - What's visible on-chain (timing, counts — never amounts)
 *  - What leaks (= ideally nothing)
 *  - The actual FHE operations the contract runs
 *
 * Other privacy products describe their guarantees in marketing copy. We
 * surface them at the point of use, with the actual ops, so users can
 * verify the claims directly against the contract.
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

const MONO_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

function Section({
  icon: Icon,
  label,
  items,
  emptyText,
  tone,
}: {
  icon: typeof Lock;
  label: string;
  items: string[];
  emptyText?: string;
  tone: "encrypted" | "visible" | "leaks";
}) {
  if (items.length === 0 && !emptyText) return null;

  const toneColor =
    tone === "encrypted"
      ? "var(--success)"
      : tone === "visible"
        ? "var(--warning)"
        : "var(--danger)";

  return (
    <div
      className="p-3.5"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <Icon size={12} style={{ color: toneColor }} />
        <p className="font-mono" style={{ ...MONO_LABEL, color: toneColor }}>
          <span style={{ opacity: 0.5 }}>— </span>
          {label}
        </p>
      </div>
      <ul className="space-y-1.5">
        {items.length === 0 ? (
          <li
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontStyle: "italic",
              lineHeight: 1.55,
            }}
          >
            {emptyText}
          </li>
        ) : (
          items.map((item, i) => (
            <li
              key={i}
              className="flex gap-2"
              style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}
            >
              <span className="shrink-0 mt-1" style={{ color: toneColor }}>
                •
              </span>
              <span>{item}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function PrivacyReportCard({
  feature,
  report,
  contractAddress,
  explorerUrl,
}: Props) {
  const [showOps, setShowOps] = useState(false);

  return (
    <section
      className="p-5"
      style={{
        background: "var(--bg-card-hover)",
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
      aria-label={`Privacy report for ${feature}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 flex items-center justify-center"
            style={{
              background: "var(--success-bg)",
              border: "1px dashed var(--border-dash)",
              borderRadius: "var(--radius)",
            }}
          >
            <Lock size={13} style={{ color: "var(--success)" }} />
          </div>
          <div>
            <h3
              className="font-display font-semibold"
              style={{ fontSize: 14, color: "var(--text)", letterSpacing: "-0.01em" }}
            >
              Privacy Report
            </h3>
            <p
              style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}
            >
              How {feature} keeps your data confidential
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowOps(!showOps)}
            className="font-mono transition-colors"
            style={MONO_LABEL}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            {showOps ? "Hide" : "Show"} FHE ops
          </button>
          {contractAddress && explorerUrl && (
            <a
              href={`${explorerUrl}/address/${contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono transition-colors"
              style={MONO_LABEL}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
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
          tone="encrypted"
          label="Encrypted"
          items={report.encrypted}
        />
        <Section
          icon={Eye}
          tone="visible"
          label="Visible on-chain"
          items={report.visible}
          emptyText="Nothing visible — fully private"
        />
        <Section
          icon={AlertTriangle}
          tone="leaks"
          label="What leaks"
          items={report.leaks}
          emptyText="Nothing leaks."
        />
      </div>

      {/* FHE ops drawer */}
      {showOps && (
        <div
          className="mt-4 p-3.5"
          style={{
            background: "var(--bg-alt)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
          }}
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Info size={11} style={{ color: "var(--text-muted)" }} />
            <p className="font-mono" style={MONO_LABEL}>
              <span style={{ opacity: 0.5 }}>— </span>
              FHE Operations Used
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.fheOps.map((op) => (
              <code
                key={op}
                className="font-mono px-2 py-0.5"
                style={{
                  fontSize: 11,
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                }}
              >
                FHE.{op}
              </code>
            ))}
          </div>
          <p
            className="mt-2"
            style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.55 }}
          >
            These run on encrypted data. The contract never sees plaintext values
            until a verified reveal (if any).
          </p>
        </div>
      )}
    </section>
  );
}
