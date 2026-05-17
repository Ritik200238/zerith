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
        className={`
          glass rounded-lg px-4 py-3 flex items-center justify-between gap-3
          ${state === "error" ? "border-red-500/30" : ""}
          ${state === "success" ? "border-emerald-500/30" : ""}
        `}
      >
        <div className="flex items-center gap-2">
          {(state === "decrypting" || state === "signing" || state === "confirming") && (
            <Loader2 size={16} className="text-purple-400 animate-spin" />
          )}
          {state === "success" && (
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check size={12} className="text-emerald-400" />
            </div>
          )}
          {state === "error" && (
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <X size={12} className="text-red-400" />
            </div>
          )}

          <div>
            <p
              className={`text-sm font-medium ${
                state === "error"
                  ? "text-red-300"
                  : state === "success"
                    ? "text-emerald-300"
                    : "text-gray-200"
              }`}
            >
              {state === "decrypting" && "Verifying with Threshold Network..."}
              {state === "signing" && "Waiting for wallet signature..."}
              {state === "confirming" && "Confirming on-chain..."}
              {state === "success" && "Transaction confirmed"}
              {state === "error" && "Transaction failed"}
            </p>
            {state === "error" && error && (
              <p className="text-xs text-red-400/70 mt-0.5 max-w-md truncate">
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {explorerUrl && state === "success" && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              View
              <ExternalLink size={12} />
            </a>
          )}
          {(state === "success" || state === "error") && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
