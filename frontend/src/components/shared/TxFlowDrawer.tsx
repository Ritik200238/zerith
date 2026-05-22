"use client";

/**
 * TxFlowDrawer — 4-step explicit progress UI for encrypted on-chain actions.
 *
 * The Why:
 *   FHE encryption + threshold submission + Ethereum confirmation legitimately
 *   takes 15-40s. A spinner with no context makes users think it's broken.
 *   This drawer breaks the wait into four named steps with per-step explainers,
 *   so the latency feels intentional, not buggy. Each step transition is a
 *   reassurance that cryptography is doing the right thing.
 *
 * Steps:
 *   1. encrypt    — Client-side encryption (cofhejs WASM, ~2-5s)
 *   2. submit     — Posting encrypted handle to the FHE network (~3-10s)
 *   3. confirm    — Ethereum L1 block confirmation (~10-25s)
 *   4. sealed     — Final success state
 *
 * Optionally an `error` state collapses the flow into a recovery panel.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Lock,
  Check,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Loader2,
} from "lucide-react";

export type TxFlowStep = "idle" | "encrypt" | "submit" | "confirm" | "sealed" | "error";

interface Props {
  open: boolean;
  step: TxFlowStep;
  /** What the user is doing — used for header copy. e.g. "Submitting your bid" */
  title?: string;
  /** Short noun for the protected value. e.g. "bid", "salary", "balance" */
  subjectNoun?: string;
  /** Optional tx hash for the L1 confirmation step */
  txHash?: string;
  /** Chain ID for explorer link */
  chainId?: number;
  /** Error message, only honored when step === "error" */
  errorMessage?: string;
  /** Called when the user closes the drawer (only when step is "sealed" or "error" or "idle") */
  onClose: () => void;
  /** Optional retry handler shown in error state */
  onRetry?: () => void;
}

const EXPLORER_BY_CHAIN: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io",
  421614: "https://sepolia.arbiscan.io",
  84532: "https://sepolia.basescan.org",
};

const MONO_LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const VALUE_BOX: React.CSSProperties = {
  background: "var(--bg-alt)",
  border: "1px dashed var(--border-dash)",
  borderRadius: "var(--radius)",
};

interface StepDef {
  key: Exclude<TxFlowStep, "idle" | "error">;
  label: string;
  activeCopy: (subject: string) => string;
  doneCopy: (subject: string) => string;
}

const STEP_DEFS: StepDef[] = [
  {
    key: "encrypt",
    label: "Encrypted locally",
    activeCopy: () =>
      "Your value is being encrypted on your device using Fhenix's WASM client. It never leaves this browser in plaintext.",
    doneCopy: () =>
      "Encrypted on your device. The original value never left this browser in plaintext.",
  },
  {
    key: "submit",
    label: "Submitting to FHE network",
    activeCopy: (subject) =>
      `Your encrypted ${subject} is being submitted to Fhenix's threshold network for sealing. This typically takes 5–10 seconds.`,
    doneCopy: (subject) =>
      `Encrypted ${subject} accepted by the FHE network and packaged for Ethereum.`,
  },
  {
    key: "confirm",
    label: "Confirming on Ethereum",
    activeCopy: () =>
      "Ethereum is confirming the transaction. This is normal L1 latency — usually 10–25 seconds on Sepolia.",
    doneCopy: () => "Confirmed on Ethereum. The encrypted handle is now permanent state.",
  },
  {
    key: "sealed",
    label: "Sealed forever",
    activeCopy: (subject) => `Your ${subject} is now sealed on-chain.`,
    doneCopy: (subject) =>
      `Done. Your ${subject} is sealed on-chain — visible only to the parties allowed by the contract. No one else can decrypt it.`,
  },
];

/** Returns -1 / 0 / 1 — is the row done, active, or upcoming? */
function statusForRow(rowKey: StepDef["key"], current: TxFlowStep): -1 | 0 | 1 {
  if (current === "error" || current === "idle") return 1;
  const order: Record<StepDef["key"], number> = {
    encrypt: 0,
    submit: 1,
    confirm: 2,
    sealed: 3,
  };
  const cur = current as StepDef["key"];
  const r = order[rowKey];
  const c = order[cur];
  if (r < c) return -1; // done
  if (r === c) return 0; // active
  return 1; // upcoming
}

export function TxFlowDrawer({
  open,
  step,
  title,
  subjectNoun = "value",
  txHash,
  chainId = 11155111,
  errorMessage,
  onClose,
  onRetry,
}: Props) {
  const [whyOpen, setWhyOpen] = useState(false);
  const explorer = EXPLORER_BY_CHAIN[chainId] ?? EXPLORER_BY_CHAIN[11155111];

  // Closable only when terminal (sealed, error) or before start (idle).
  const closable = step === "sealed" || step === "error" || step === "idle";

  const headerCopy = useMemo(() => {
    if (step === "error") return "Something went wrong";
    if (step === "sealed") return title ?? "Sealed";
    return title ?? `Submitting your encrypted ${subjectNoun}`;
  }, [step, title, subjectNoun]);

  const subheaderCopy = useMemo(() => {
    if (step === "error") return "The action did not complete. You can retry below.";
    if (step === "sealed") return "Cryptography did the work — here's what happened.";
    return "Cryptography is working. This may take 15–40 seconds total.";
  }, [step]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="txflow-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closable ? onClose : undefined}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(17,17,17,0.40)", backdropFilter: "blur(6px)" }}
          />
          <motion.aside
            key="txflow"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] flex flex-col"
            style={{
              background: "var(--bg-card)",
              borderLeft: "1px dashed var(--border-dash)",
            }}
            role="dialog"
            aria-label="Encrypted transaction progress"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: "1px dashed var(--border-dash)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 flex items-center justify-center"
                  style={{
                    background:
                      step === "error"
                        ? "var(--danger-bg, rgba(215,119,87,0.10))"
                        : step === "sealed"
                          ? "var(--success-bg)"
                          : "var(--bg-alt)",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  {step === "error" ? (
                    <AlertCircle size={16} style={{ color: "var(--danger, #d77757)" }} />
                  ) : step === "sealed" ? (
                    <Check size={16} style={{ color: "var(--success)" }} />
                  ) : (
                    <Lock size={16} style={{ color: "var(--text)" }} />
                  )}
                </div>
                <div>
                  <h3
                    className="font-display font-semibold"
                    style={{ fontSize: 14, color: "var(--text)" }}
                  >
                    {headerCopy}
                  </h3>
                  <p className="font-mono" style={MONO_LABEL}>
                    {subheaderCopy}
                  </p>
                </div>
              </div>
              {closable && (
                <button
                  onClick={onClose}
                  className="p-1.5 transition-colors"
                  style={{ color: "var(--text-muted)", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {step === "error" ? (
                <section>
                  <p
                    className="font-mono mb-2"
                    style={{ ...MONO_LABEL, color: "var(--danger, #d77757)" }}
                  >
                    <span style={{ opacity: 0.5 }}>— </span>
                    Error details
                  </p>
                  <div className="p-4" style={VALUE_BOX}>
                    <p
                      className="break-words"
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        lineHeight: 1.55,
                      }}
                    >
                      {errorMessage ?? "Unknown error."}
                    </p>
                  </div>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="btn btn-primary btn-sm mt-4 w-full justify-center"
                    >
                      Try again
                    </button>
                  )}
                </section>
              ) : (
                <ol className="space-y-3">
                  {STEP_DEFS.map((row, idx) => {
                    const s = statusForRow(row.key, step);
                    const isActive = s === 0;
                    const isDone = s === -1;
                    const isUpcoming = s === 1;
                    return (
                      <li
                        key={row.key}
                        className="p-4"
                        style={{
                          ...VALUE_BOX,
                          opacity: isUpcoming ? 0.55 : 1,
                          transition: "opacity 250ms ease",
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-6 h-6 shrink-0 flex items-center justify-center"
                            style={{
                              borderRadius: 999,
                              background: isDone
                                ? "var(--success-bg)"
                                : isActive
                                  ? "var(--bg-card)"
                                  : "transparent",
                              border: `1px ${isDone ? "solid" : "dashed"} ${
                                isDone
                                  ? "var(--success)"
                                  : isActive
                                    ? "var(--text)"
                                    : "var(--border-dash)"
                              }`,
                            }}
                          >
                            {isDone ? (
                              <Check size={12} style={{ color: "var(--success)" }} />
                            ) : isActive ? (
                              <Loader2 size={12} className="animate-spin" style={{ color: "var(--text)" }} />
                            ) : (
                              <span
                                className="font-mono"
                                style={{ fontSize: 10, color: "var(--text-muted)" }}
                              >
                                {idx + 1}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="font-display font-semibold"
                              style={{ fontSize: 13, color: "var(--text)" }}
                            >
                              {row.label}
                            </p>
                            {(isActive || isDone) && (
                              <p
                                className="mt-1.5"
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                {isDone
                                  ? row.doneCopy(subjectNoun)
                                  : row.activeCopy(subjectNoun)}
                              </p>
                            )}
                            {isActive && row.key !== "sealed" && (
                              <div
                                className="mt-2.5 h-1 overflow-hidden"
                                style={{
                                  background: "var(--bg-alt)",
                                  borderRadius: 999,
                                }}
                              >
                                <motion.div
                                  initial={{ width: "5%" }}
                                  animate={{ width: ["10%", "75%", "92%"] }}
                                  transition={{
                                    duration: 14,
                                    ease: "easeOut",
                                    times: [0, 0.6, 1],
                                  }}
                                  style={{ height: "100%", background: "var(--text)" }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* On-chain tx link, shown as soon as we have a hash */}
              {txHash && (
                <section>
                  <p className="font-mono mb-2" style={MONO_LABEL}>
                    <span style={{ opacity: 0.5 }}>— </span>
                    On-chain transaction
                  </p>
                  <a
                    href={`${explorer}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 transition-colors"
                    style={VALUE_BOX}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-card-hover)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-alt)")}
                  >
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, color: "var(--text-secondary)" }}
                    >
                      {txHash.slice(0, 14)}…{txHash.slice(-12)}
                    </span>
                    <span className="flex items-center gap-1 font-mono" style={MONO_LABEL}>
                      Explorer
                      <ExternalLink size={10} />
                    </span>
                  </a>
                </section>
              )}

              {/* Why so slow — expandable explainer */}
              {step !== "error" && step !== "sealed" && (
                <section
                  className="pt-2"
                  style={{ borderTop: "1px dashed var(--border-dash)" }}
                >
                  <button
                    onClick={() => setWhyOpen((v) => !v)}
                    className="flex items-center justify-between w-full py-2 transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = "var(--text-muted)")
                    }
                  >
                    <span className="font-mono" style={MONO_LABEL}>
                      Why does this take so long?
                    </span>
                    <ChevronDown
                      size={12}
                      style={{
                        transform: whyOpen ? "rotate(180deg)" : "rotate(0)",
                        transition: "transform 200ms ease",
                      }}
                    />
                  </button>
                  <AnimatePresence>
                    {whyOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: "hidden" }}
                      >
                        <p
                          className="pt-1"
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            lineHeight: 1.6,
                          }}
                        >
                          Most blockchain apps reveal your value in plaintext —
                          which is why they feel instant. Zerith encrypts your
                          value client-side, then a threshold network of
                          independent operators co-signs it so no single party
                          can decrypt it later. That cryptography takes seconds,
                          not milliseconds. The latency is the privacy.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
