"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/shared/Toast";
import { useTxSound } from "./useTxSound";
import type { TxState } from "@/components/shared/TransactionStatus";

type NotifType = "auction" | "trade" | "escrow" | "payment" | "system";

interface TxFeedbackConfig {
  /** Toast title (e.g. "Sealed Auction"). */
  label: string;
  /** Notification bell type — picks icon/color. */
  type: NotifType;
  /** Where the notification routes when clicked. */
  href: string;
  /** Current tx hash, surfaced in the notification payload. */
  txHash?: string;
}

/**
 * Audit fix G2/G3: single source for tx success side effects.
 *
 * Watches a page's txState. On the transition into "success":
 *  - fires a toast with the per-page label
 *  - dispatches a `zerith-notify` window event so the bell logs it
 *
 * Idempotent — only fires once per success transition. Resetting txState
 * back to "idle" arms it again for the next tx.
 */
export function useTxFeedback(state: TxState, config: TxFeedbackConfig) {
  const toast = useToast();
  const fired = useRef<TxState>("idle");

  // Optional success chime — opt-in via localStorage key zerith-sound-enabled.
  useTxSound(state);

  useEffect(() => {
    if (state === "success" && fired.current !== "success") {
      fired.current = "success";
      toast.success(config.label, "Transaction confirmed on-chain");
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("zerith-notify", {
            detail: {
              type: config.type,
              title: config.label,
              message: config.txHash
                ? `Tx ${config.txHash.slice(0, 10)}…`
                : "Transaction confirmed",
              href: config.href,
            },
          }),
        );
      }
    }
    if (state === "idle" || state === "signing" || state === "decrypting") {
      fired.current = "idle";
    }
  }, [state, config.label, config.type, config.href, config.txHash, toast]);
}
