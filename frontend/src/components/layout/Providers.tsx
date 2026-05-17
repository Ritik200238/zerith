"use client";

import { WalletProvider } from "@/providers/WalletProvider";
import { CofheProvider } from "@/providers/CofheProvider";
import { Cofhe2Provider } from "@/providers/Cofhe2Provider";
import { PrivacyLensProvider } from "@/providers/PrivacyLensProvider";
import { ToastProvider } from "@/components/shared/Toast";

/**
 * Client-side provider tree. Wraps the entire app with wallet, FHE, and toast
 * contexts. Kept separate from layout.tsx so the root layout can remain a
 * server component.
 *
 * Two FHE providers run in parallel during the cofhejs → @cofhe/sdk migration:
 * - CofheProvider (legacy cofhejs@0.3.1) — used by 17 existing pages
 * - Cofhe2Provider (@cofhe/sdk@0.5+) — used by new "Reveal Verified" + future flows
 *
 * Each feature migrates independently. Both can coexist.
 *
 * Toast is mounted here so any component (including the AppShell's
 * OnboardingModal / FaucetButton / etc.) can call useToast().
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <CofheProvider>
        <Cofhe2Provider>
          <PrivacyLensProvider>
            <ToastProvider>{children}</ToastProvider>
          </PrivacyLensProvider>
        </Cofhe2Provider>
      </CofheProvider>
    </WalletProvider>
  );
}
