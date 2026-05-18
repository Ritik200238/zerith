"use client";

import { motion } from "framer-motion";
import { ENCRYPT_STAGES } from "@/lib/constants";
import type { EncryptStage } from "@/hooks/useEncrypt";
import { Lock, Check, Loader2 } from "lucide-react";

interface EncryptionProgressProps {
  stage: EncryptStage;
  visible: boolean;
}

const STAGE_ORDER: EncryptStage[] = ["extract", "pack", "prove", "verify", "replace", "done"];

/**
 * 6-stage progress bar that visualizes the cofhejs.encrypt() pipeline.
 * Each stage lights up as the encryption proceeds through:
 * Extract -> Pack -> Prove -> Verify -> Replace -> Done
 */
export function EncryptionProgress({ stage, visible }: EncryptionProgressProps) {
  if (!visible || stage === "idle") return null;

  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="editorial-card p-4 space-y-3"
    >
      <div
        className="flex items-center gap-2 font-mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        <Lock size={12} />
        Secure Processing
      </div>

      <div className="flex gap-1.5">
        {ENCRYPT_STAGES.map((s, i) => {
          const isComplete = currentIndex > i || stage === "done";
          const isCurrent = currentIndex === i && stage !== "done";

          return (
            <div key={s.key} className="flex-1 flex flex-col gap-1.5">
              {/* Progress bar segment */}
              <div
                className="overflow-hidden"
                style={{
                  height: 2,
                  background: "var(--bg-alt)",
                  borderRadius: 1,
                }}
              >
                <motion.div
                  style={{
                    height: "100%",
                    background: isComplete || isCurrent ? "var(--text)" : "transparent",
                  }}
                  initial={{ width: "0%" }}
                  animate={{ width: isComplete ? "100%" : isCurrent ? "60%" : "0%" }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>

              {/* Label */}
              <div className="flex items-center gap-1">
                {isComplete ? (
                  <Check size={9} style={{ color: "var(--success)" }} />
                ) : isCurrent ? (
                  <Loader2 size={9} className="animate-spin" style={{ color: "var(--text)" }} />
                ) : null}
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.06em",
                    color: isComplete
                      ? "var(--success)"
                      : isCurrent
                        ? "var(--text)"
                        : "var(--text-muted)",
                  }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {stage === "error" && (
        <p style={{ fontSize: 12, color: "var(--danger)" }}>
          Encryption failed. Please try again.
        </p>
      )}
    </motion.div>
  );
}
