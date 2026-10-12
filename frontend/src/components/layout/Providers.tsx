"use client";

import { useEffect } from "react";
import { WalletProvider } from "@/providers/WalletProvider";
import { CofheProvider } from "@/providers/CofheProvider";
import { PrivacyLensProvider } from "@/providers/PrivacyLensProvider";
import { ToastProvider } from "@/components/shared/Toast";
import { migrateSigilToZerith } from "@/lib/storage-migration";

/**
 * Client-side provider tree. Wraps the entire app with wallet, FHE, and toast
 * contexts. Kept separate from layout.tsx so the root layout can remain a
 * server component.
 *
 * CofheProvider holds the single @cofhe/sdk (CoFHE 1.0) client used for
 * encryption, unsealing and Threshold Network reveals.
 *
 * Toast is mounted here so any component (including the AppShell's
 * OnboardingModal / FaucetButton / etc.) can call useToast().
 *
 * One-shot effect: on first render, migrate any legacy sigil-* localStorage
 * keys to the zerith-* namespace. Idempotent and silent on subsequent runs.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    migrateSigilToZerith();
  }, []);

  return (
    <WalletProvider>
      <CofheProvider>
        <PrivacyLensProvider>
          <ToastProvider>{children}</ToastProvider>
        </PrivacyLensProvider>
      </CofheProvider>
    </WalletProvider>
  );
}
