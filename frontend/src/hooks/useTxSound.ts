"use client";

import { useEffect, useRef } from "react";
import type { TxState } from "@/components/shared/TransactionStatus";

const STORAGE_KEY = "zerith-sound-enabled";

/**
 * useTxSound — emits a tiny success chime when a tx transitions to success.
 *
 * Off by default. User can toggle via localStorage key `zerith-sound-enabled`
 * (`"1"` to enable). The settings dropdown (future) wires this; for now any
 * curious user can flip it from devtools.
 *
 * Built with the Web Audio API (no asset dependency). One short pitch ramp,
 * <120ms. Soft enough not to startle, distinct enough to register.
 */
export function useTxSound(state: TxState) {
  const fired = useRef<TxState>("idle");
  useEffect(() => {
    if (state === "success" && fired.current !== "success") {
      fired.current = "success";
      try {
        if (typeof window === "undefined") return;
        const enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
        if (!enabled) return;
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
      } catch {
        // ignore — audio is best-effort
      }
    }
    if (state === "idle" || state === "signing" || state === "decrypting") {
      fired.current = "idle";
    }
  }, [state]);
}

/** Toggle helper that pages can call from a settings UI. */
export function setTxSoundEnabled(enabled: boolean) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function getTxSoundEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
