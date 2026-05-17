"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Copy, ExternalLink, Check } from "lucide-react";

/**
 * Trust artifact: shows the Threshold Network signature proof for any reveal.
 *
 * What user sees: click any "Verified" chip → drawer slides in from right.
 * Shows: ctHash, decrypted value, TN signature, on-chain tx link, copy buttons.
 *
 * This is the visible expression of the verifiable-reveal narrative —
 * privacy isn't a marketing claim, it's a cryptographic proof anyone can check.
 */

export interface SignatureProof {
  /** Encrypted handle that was decrypted */
  ctHash: string;
  /** Decrypted plaintext value (formatted for display) */
  decryptedValue: string;
  /** Threshold Network signature (0x...) */
  signature: string;
  /** Optional: on-chain tx hash where the reveal was published */
  txHash?: string;
  /** Optional: chain ID for etherscan link */
  chainId?: number;
  /** Optional: human label for the value (e.g. "Winning bid", "Bidder address") */
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function shorten(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

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
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            key="sig-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px]
                       bg-[var(--void-1,#0a0a0f)] border-l border-white/10
                       flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-100">Verified Reveal</h3>
                  <p className="text-xs text-gray-500">
                    Signed by Fhenix Threshold Network
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-white/[0.06] transition"
                aria-label="Close"
              >
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Plaintext value (hero) */}
              <section>
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
                  {proof.label ?? "Decrypted value"}
                </p>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                  <p className="font-mono text-lg text-gray-100 break-all">
                    {proof.decryptedValue}
                  </p>
                </div>
              </section>

              {/* Encrypted handle */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Encrypted handle (ctHash)
                  </p>
                  <CopyButton value={proof.ctHash} />
                </div>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                  <p className="font-mono text-xs text-gray-300 break-all">
                    {shorten(proof.ctHash, 14, 12)}
                  </p>
                </div>
              </section>

              {/* TN signature */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Threshold Network signature
                  </p>
                  <CopyButton value={proof.signature} />
                </div>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                  <p className="font-mono text-xs text-emerald-300 break-all">
                    {shorten(proof.signature, 18, 16)}
                  </p>
                </div>
                <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                  This signature proves the threshold network honestly decrypted
                  the handle. The smart contract verified it on-chain via
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-white/[0.04] text-gray-300">
                    FHE.publishDecryptResult
                  </code>
                  before accepting the value.
                </p>
              </section>

              {/* On-chain tx */}
              {proof.txHash && explorer && (
                <section>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
                    Published on-chain
                  </p>
                  <a
                    href={`${explorer}/tx/${proof.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg
                               bg-white/[0.02] border border-white/5 p-3
                               hover:bg-white/[0.04] hover:border-white/10 transition"
                  >
                    <span className="font-mono text-xs text-gray-300">
                      {shorten(proof.txHash, 14, 12)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      Explorer
                      <ExternalLink size={11} />
                    </span>
                  </a>
                </section>
              )}

              {/* What this means */}
              <section className="rounded-lg bg-emerald-500/[0.04] border border-emerald-500/10 p-4">
                <h4 className="text-sm font-semibold text-emerald-300 mb-1.5">
                  What this proves
                </h4>
                <ul className="space-y-1.5 text-[12px] text-gray-300 leading-relaxed">
                  <li className="flex gap-2">
                    <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                    The decrypted value matches the original encrypted input.
                  </li>
                  <li className="flex gap-2">
                    <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                    Multiple independent operators agreed on the result.
                  </li>
                  <li className="flex gap-2">
                    <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                    No single party (not us, not the operators) could have faked it.
                  </li>
                </ul>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
