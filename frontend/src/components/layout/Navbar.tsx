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
          aria-label="Zerith home"
        >
          <span
            className="font-display font-bold tracking-tight text-text leading-none"
            style={{ fontSize: 17, letterSpacing: "-0.02em" }}
          >
            Zer<em className="font-serif italic font-normal">ith</em>
          </span>
          <span
            className="font-mono leading-none hidden lg:inline"
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Private finance
          </span>
        </Link>

        {/* Right cluster — PermitManager + NotificationBell hidden on mobile
            (navbar would otherwise overflow 375px viewport). Both remain
            reachable via in-page surfaces (permit prompts, activity feed). */}
        <div className="flex items-center gap-2 md:gap-3 ml-auto">
          <PrivacyLensToggle />
          <FaucetButton />
          <div className="hidden md:flex items-center gap-2 md:gap-3">
            <PermitManager />
            <NotificationBell />
          </div>
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
