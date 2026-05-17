"use client";

/**
 * PrivacyLens — renders a row of values whose appearance switches based on
 * the global PrivacyLensProvider mode (me / counterparty / observer).
 *
 * Local two-mode toggles were a 2026-05 audit gap. This new version reads
 * the global context so the toggle in the Navbar drives every PrivacyLens
 * on the page in sync.
 */

import { motion, AnimatePresence } from "framer-motion";
import { Eye, Lock, Hash, User, Users, Globe2 } from "lucide-react";
import { usePrivacyLens, pickByMode } from "@/providers/PrivacyLensProvider";

export interface PrivacyLensRow {
  label: string;
  /** What I see — full plaintext via unseal permit. */
  meValue: string;
  /** What a counterparty I'm trading with sees (e.g. their own quote price, range I allowed). */
  counterpartyValue?: string;
  /** What a public observer sees — ciphertext hash or "🔒 sealed". */
  observerValue: string;
  /** Whether this value is encrypted on-chain. Drives the styling. */
  encrypted: boolean;
}

interface PrivacyLensProps {
  rows: PrivacyLensRow[];
  title?: string;
}

export function PrivacyLens({ rows, title = "Privacy Lens" }: PrivacyLensProps) {
  const { mode } = usePrivacyLens();

  const Icon = mode === "me" ? User : mode === "counterparty" ? Users : Globe2;
  const modeLabel =
    mode === "me" ? "Your view" : mode === "counterparty" ? "Counterparty view" : "Observer view";

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: 4,
      }}
      className="overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px dashed var(--border-dash)" }}
      >
        <div className="flex items-center gap-2">
          <Eye className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
          <span className="mono" style={{ color: "var(--text-muted)" }}>
            {title}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 mono"
          style={{ color: "var(--text)" }}
        >
          <Icon className="w-3 h-3" />
          {modeLabel.toUpperCase()}
        </div>
      </div>

      {/* Rows */}
      <div>
        {rows.map((row, i) => {
          const value = pickByMode(mode, {
            me: row.meValue,
            counterparty: row.counterpartyValue ?? row.observerValue,
            observer: row.observerValue,
          });
          const isHashView = row.encrypted && mode === "observer";
          return (
            <div
              key={i}
              className="px-5 py-3 flex items-center justify-between gap-3"
              style={i < rows.length - 1 ? { borderBottom: "1px dashed var(--border-dash)" } : undefined}
            >
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                {row.label}
              </span>
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode + "-" + i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-1.5 min-w-0"
                >
                  {isHashView ? (
                    <>
                      <Hash className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                      <span
                        className="font-mono text-xs max-w-[220px] truncate"
                        style={{ color: "var(--text-muted)" }}
                        title={value}
                      >
                        {value}
                      </span>
                    </>
                  ) : (
                    <>
                      {row.encrypted && mode === "counterparty" && value === (row.observerValue) && (
                        <Lock className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                      )}
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {value}
                      </span>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
