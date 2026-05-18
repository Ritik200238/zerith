"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check, X, ExternalLink } from "lucide-react";
import { FHENIX_TESTNET } from "@/lib/constants";

export type TxState =
  | "idle"
  | "decrypting"   // fetching value+signature from Threshold Network
  | "signing"      // user is signing the on-chain reveal tx
  | "confirming"   // tx submitted, waiting for block confirmation
  | "success"
  | "error";

interface TransactionStatusProps {
  state: TxState;
  txHash?: string;
  error?: string;
  onDismiss?: () => void;
}

/**
 * Inline transaction status indicator that shows signing -> confirming -> success/error.
 * Links to block explorer on success.
 */
export function TransactionStatus({
  state,
  txHash,
  error,
  onDismiss,
}: TransactionStatusProps) {
  if (state === "idle") return null;

  const explorerUrl = txHash
    ? `${FHENIX_TESTNET.blockExplorer}/tx/${txHash}`
    : undefined;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="px-4 py-3 flex items-center justify-between gap-3"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-dash)",
          borderRadius: "var(--radius)",
        }}
      >
        <div className="flex items-center gap-3">
          {(state === "decrypting" || state === "signing" || state === "confirming") && (
            <Loader2 size={14} className="animate-spin" style={{ color: "var(--text)" }} />
          )}
          {state === "success" && (
            <div
              className="w-5 h-5 flex items-center justify-center"
              style={{
                background: "var(--success-bg)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
              }}
            >
              <Check size={11} style={{ color: "var(--success)" }} />
            </div>
          )}
          {state === "error" && (
            <div
              className="w-5 h-5 flex items-center justify-center"
              style={{
                background: "var(--danger-bg)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
              }}
            >
              <X size={11} style={{ color: "var(--danger)" }} />
            </div>
          )}

          <div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  state === "error"
                    ? "var(--danger)"
                    : state === "success"
                      ? "var(--success)"
                      : "var(--text)",
              }}
            >
              {state === "decrypting" && "Verifying with Threshold Network..."}
              {state === "signing" && "Waiting for wallet signature..."}
              {state === "confirming" && "Confirming on-chain..."}
              {state === "success" && "Transaction confirmed"}
              {state === "error" && "Transaction failed"}
            </p>
            {state === "error" && error && (
              <p
                className="mt-0.5 max-w-md truncate"
                style={{ fontSize: 11, color: "var(--text-muted)" }}
              >
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {explorerUrl && state === "success" && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono transition-colors"
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              View
              <ExternalLink size={11} />
            </a>
          )}
          {(state === "success" || state === "error") && onDismiss && (
            <button
              onClick={onDismiss}
              className="transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
