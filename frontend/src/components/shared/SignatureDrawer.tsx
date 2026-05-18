"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Copy, ExternalLink, Check } from "lucide-react";

/**
 * Trust artifact: shows the Threshold Network signature proof for any reveal.
 *
 * Click any "Verified" chip → drawer slides in from right. Shows ctHash,
 * decrypted value, TN signature, on-chain tx link, copy buttons. The visible
 * expression of verifiable reveal — privacy isn't a claim, it's a proof
 * anyone can check.
 */

export interface SignatureProof {
  ctHash: string;
  decryptedValue: string;
  signature: string;
  txHash?: string;
  chainId?: number;
  label?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  proof: SignatureProof | null;
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 font-mono transition-colors"
      style={MONO_LABEL}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function shorten(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

const VALUE_BOX: React.CSSProperties = {
  background: "var(--bg-alt)",
  border: "1px dashed var(--border-dash)",
  borderRadius: "var(--radius)",
};

export function SignatureDrawer({ open, onClose, proof }: Props) {
  const explorer = proof?.chainId ? EXPLORER_BY_CHAIN[proof.chainId] : undefined;

  return (
    <AnimatePresence>
      {open && proof && (
        <>
          <motion.div
            key="sig-drawer-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(17,17,17,0.40)", backdropFilter: "blur(6px)" }}
          />
          <motion.aside
            key="sig-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] flex flex-col"
            style={{
              background: "var(--bg-card)",
              borderLeft: "1px dashed var(--border-dash)",
            }}
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
                    background: "var(--success-bg)",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <ShieldCheck size={16} style={{ color: "var(--success)" }} />
                </div>
                <div>
                  <h3
                    className="font-display font-semibold"
                    style={{ fontSize: 14, color: "var(--text)" }}
                  >
                    Verified Reveal
                  </h3>
                  <p className="font-mono" style={MONO_LABEL}>
                    Signed by Fhenix Threshold Network
                  </p>
                </div>
              </div>
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
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Plaintext value */}
              <section>
                <p className="font-mono mb-2" style={MONO_LABEL}>
                  <span style={{ opacity: 0.5 }}>— </span>
                  {proof.label ?? "Decrypted value"}
                </p>
                <div className="p-4" style={VALUE_BOX}>
                  <p
                    className="font-mono break-all"
                    style={{ fontSize: 18, color: "var(--text)", fontWeight: 500 }}
                  >
                    {proof.decryptedValue}
                  </p>
                </div>
              </section>

              {/* Encrypted handle */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono" style={MONO_LABEL}>
                    <span style={{ opacity: 0.5 }}>— </span>
                    Encrypted handle (ctHash)
                  </p>
                  <CopyButton value={proof.ctHash} />
                </div>
                <div className="p-3" style={VALUE_BOX}>
                  <p
                    className="font-mono break-all"
                    style={{ fontSize: 11, color: "var(--text-secondary)" }}
                  >
                    {shorten(proof.ctHash, 14, 12)}
                  </p>
                </div>
              </section>

              {/* TN signature */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono" style={MONO_LABEL}>
                    <span style={{ opacity: 0.5 }}>— </span>
                    Threshold Network signature
                  </p>
                  <CopyButton value={proof.signature} />
                </div>
                <div className="p-3" style={VALUE_BOX}>
                  <p
                    className="font-mono break-all"
                    style={{ fontSize: 11, color: "var(--success)" }}
                  >
                    {shorten(proof.signature, 18, 16)}
                  </p>
                </div>
                <p
                  className="mt-2"
                  style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.55 }}
                >
                  This signature proves the threshold network honestly decrypted
                  the handle. The smart contract verified it on-chain via{" "}
                  <code
                    className="mx-1 px-1.5 py-0.5 font-mono"
                    style={{
                      fontSize: 10,
                      background: "var(--bg-alt)",
                      borderRadius: 3,
                      color: "var(--text)",
                    }}
                  >
                    FHE.publishDecryptResult
                  </code>{" "}
                  before accepting the value.
                </p>
              </section>

              {/* On-chain tx */}
              {proof.txHash && explorer && (
                <section>
                  <p className="font-mono mb-2" style={MONO_LABEL}>
                    <span style={{ opacity: 0.5 }}>— </span>
                    Published on-chain
                  </p>
                  <a
                    href={`${explorer}/tx/${proof.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 transition-colors"
                    style={VALUE_BOX}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-card-hover)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "var(--bg-alt)")
                    }
                  >
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, color: "var(--text-secondary)" }}
                    >
                      {shorten(proof.txHash, 14, 12)}
                    </span>
                    <span
                      className="flex items-center gap-1 font-mono"
                      style={MONO_LABEL}
                    >
                      Explorer
                      <ExternalLink size={10} />
                    </span>
                  </a>
                </section>
              )}

              {/* What this proves */}
              <section
                className="p-4"
                style={{
                  background: "var(--success-bg)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: "var(--radius)",
                }}
              >
                <h4
                  className="font-display font-semibold mb-2"
                  style={{ fontSize: 13, color: "var(--text)" }}
                >
                  What this proves
                </h4>
                <ul
                  className="space-y-2"
                  style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}
                >
                  {[
                    "The decrypted value matches the original encrypted input.",
                    "Multiple independent operators agreed on the result.",
                    "No single party (not us, not the operators) could have faked it.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check
                        size={12}
                        className="mt-0.5 shrink-0"
                        style={{ color: "var(--success)" }}
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
