"use client";

import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { OnboardingModal } from "@/components/shared/OnboardingModal";
import { SystemStatus } from "@/components/shared/SystemStatus";

/**
 * Zerith editorial app shell.
 * - Warm off-white canvas (var(--bg))
 * - Fixed left sidebar (68px collapsed, 240px hover-expanded) on md+
 * - Fixed top navbar (64px) with dashed bottom border
 * - Responsive content max-width 1180px on wide screens, fluid below
 * - Global mounts: OnboardingModal (first-visit), SystemStatus (footer bar)
 *   Toast is already mounted inside Providers.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text relative">
      <Sidebar />
      <Navbar />

      <main
        className="md:ml-[68px] min-h-[calc(100vh-var(--nav-height))] relative z-10"
        style={{ marginTop: "var(--nav-height)" }}
      >
        <div className="mx-auto w-full max-w-container px-5 md:px-10 py-10 md:py-14">
          {children}
        </div>

        {/* Editorial footer with live system pulse */}
        <footer
          className="md:ml-0 mt-16"
          style={{ borderTop: "1px dashed var(--border-dash)" }}
        >
          <div className="mx-auto w-full max-w-container px-5 md:px-10 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
                — System Status
              </span>
            </div>
            <SystemStatus />
          </div>
          <div className="mx-auto w-full max-w-container px-5 md:px-10 pb-6 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
              CipherDEX · Fhenix FHE
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
              v1.0 · Buildathon
            </span>
          </div>
        </footer>
      </main>

      {/* Global mounts */}
      <OnboardingModal />
    </div>
  );
}
