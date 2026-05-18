"use client";

import { motion } from "framer-motion";
import { Unlock, Loader2 } from "lucide-react";

interface DecryptionSpinnerProps {
  visible: boolean;
  label?: string;
}

/**
 * Compact spinner shown while unsealing encrypted data via cofhejs.unseal().
 */
export function DecryptionSpinner({
  visible,
  label = "Processing...",
}: DecryptionSpinnerProps) {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 text-sm text-text"
    >
      <div className="relative">
        <Unlock size={14} className="text-text" />
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 size={14} className="text-text opacity-40" />
        </motion.div>
      </div>
      <span>{label}</span>
    </motion.div>
  );
}
