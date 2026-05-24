"use client";

/**
 * PrivacyLensProvider — global 3-mode visibility toggle.
 *
 * The Privacy Lens is the visual moment that sells FHE: a single button that
 * shows the same page from three perspectives:
 *
 *   • me           — I unseal my own data via permit; I see plaintext.
 *   • counterparty — A party I'm transacting with sees what FHE grants them
 *                    (their own amounts, ranges I've allowed, hashed identity).
 *   • observer     — A random public observer sees only ciphertext hashes,
 *                    addresses, and timestamps. Amounts/prices are 🔒 sealed.
 *
 * Components subscribe to `usePrivacyLens()` and render the right value for
 * the active mode. The toggle is mounted globally in the Navbar so any page
 * gets the same affordance, addressing the audit gap "PrivacyLens used on
 * 1 of 26 pages."
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type PrivacyMode = "me" | "counterparty" | "observer";

interface PrivacyLensContextValue {
  mode: PrivacyMode;
  setMode: (m: PrivacyMode) => void;
  cycle: () => void;
}

const PrivacyLensContext = createContext<PrivacyLensContextValue | null>(null);

const STORAGE_KEY = "zerith-privacy-lens-mode";
const MODES: PrivacyMode[] = ["me", "counterparty", "observer"];

export function PrivacyLensProvider({ children }: { children: ReactNode }) {
  // Default-on: a first-time visitor opens the site in "observer" mode so the
  // privacy claim is in their face from the first paint (sealed handles + 🔒
  // markers everywhere). Returning users get whatever they explicitly set last
  // — localStorage hydrate below overrides this when present.
  const [mode, setModeState] = useState<PrivacyMode>("observer");

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "me" || stored === "counterparty" || stored === "observer") {
        setModeState(stored);
      }
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }, []);

  const setMode = useCallback((m: PrivacyMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next = MODES[(MODES.indexOf(prev) + 1) % MODES.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, setMode, cycle }), [mode, setMode, cycle]);

  return <PrivacyLensContext.Provider value={value}>{children}</PrivacyLensContext.Provider>;
}

export function usePrivacyLens(): PrivacyLensContextValue {
  const ctx = useContext(PrivacyLensContext);
  if (!ctx) {
    // Defensive default — components calling this outside the provider get a
    // safe no-op rather than crashing. Should never happen in production.
    return {
      mode: "me",
      setMode: () => {},
      cycle: () => {},
    };
  }
  return ctx;
}

/** Pick the right value for the active mode. */
export function pickByMode<T>(
  mode: PrivacyMode,
  values: { me: T; counterparty: T; observer: T },
): T {
  return values[mode];
}
