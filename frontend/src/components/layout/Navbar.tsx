"use client";

import Link from "next/link";
import { WalletConnect } from "@/components/shared/WalletConnect";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { PermitManager } from "@/components/shared/PermitManager";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { PrivacyLensToggle } from "@/components/shared/PrivacyLensToggle";

/**
 * Zerith editorial top bar.
 * - Warm-translucent bg with backdrop-blur
 * - Dashed bottom border (editorial signature)
 * - Brand mark left, actions right (Faucet, Permits, Notifications, Wallet)
 */
export function Navbar() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40"
      style={{
        height: "var(--nav-height)",
        background: "var(--nav-bg)",
        backdropFilter: "blur(14px) saturate(1.05)",
        WebkitBackdropFilter: "blur(14px) saturate(1.05)",
        borderBottom: "1px dashed var(--border-dash)",
      }}
    >
      <div className="h-full flex items-center justify-between pl-[80px] md:pl-[88px] pr-4 md:pr-6">
        {/* Brand mark — visible on mobile (sidebar collapses) */}
        <Link
          href="/"
          className="hidden md:flex items-center gap-2.5 group"
          aria-label="CipherDEX home"
        >
          <span className="font-display text-[17px] font-bold tracking-tight text-text leading-none">
            CipherDEX
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted leading-none mt-[2px] hidden lg:inline">
            Fhenix FHE
          </span>
        </Link>

        {/* Right cluster */}
        <div className="flex items-center gap-2 md:gap-3 ml-auto">
          <PrivacyLensToggle />
          <FaucetButton />
          <PermitManager />
          <NotificationBell />
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
