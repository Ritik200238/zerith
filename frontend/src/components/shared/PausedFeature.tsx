import Link from "next/link";
import { PauseCircle, ArrowRight } from "lucide-react";

/**
 * Placeholder for a feature that's paused. Its contract predates Fhenix CoFHE 1.0,
 * so encrypted writes to it no longer work; rather than show a form that can only
 * fail, the route explains what happened and points to the core product.
 * The previous page lives in frontend/legacy-pages/ until the feature is ported.
 */
export function PausedFeature({ name, summary }: { name: string; summary: string }) {
  return (
    <div className="font-body max-w-[760px] mx-auto py-12 md:py-20 space-y-8" style={{ color: "var(--text)" }}>
      <div className="font-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        — Paused feature
      </div>
      <h1
        className="font-display font-bold tracking-tight leading-[1.05]"
        style={{ fontSize: "clamp(32px, 4.4vw, 52px)", letterSpacing: "-0.03em" }}
      >
        Paused: {name}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.65 }}>{summary}</p>

      <div
        className="flex items-start gap-3 px-5 py-4"
        style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: "var(--radius)" }}
      >
        <PauseCircle size={18} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          Fhenix moved its testnet to a new encryption format (CoFHE 1.0) in October 2026. This
          feature&apos;s contract was built for the old format, so it can&apos;t accept encrypted
          inputs any more. We&apos;re rebuilding it on the same escrowed settlement as the core
          product before turning it back on. Nothing you hold is affected: balances live in your
          wallet and in the Treasury vault.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { href: "/auctions", label: "Sealed block sales" },
          { href: "/treasury", label: "Treasury" },
          { href: "/payments", label: "Payroll" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
          >
            {l.label} <ArrowRight size={13} />
          </Link>
        ))}
      </div>
    </div>
  );
}
