"use client";

export const dynamic = "force-dynamic";

/**
 * /more — the secondary surface.
 *
 * After trimming primary nav to the wedge-focused 5 (Dashboard, Block Sales,
 * Treasury, Audit, More), every other feature lives here. Pages remain at
 * their URLs; this page is the editorial index so they stay discoverable
 * without polluting the sidebar a foundation finance lead sees on landing.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Eye,
  TrendingDown,
  Layers,
  Droplets,
  CreditCard,
  Users,
  ArrowLeftRight,
  Activity,
  Star,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { SECONDARY_NAV } from "@/lib/constants";

const ICON_MAP: Record<string, LucideIcon> = {
  Eye,
  TrendingDown,
  Layers,
  Droplets,
  CreditCard,
  Users,
  ArrowLeftRight,
  Activity,
  Star,
  Sparkles,
};

export default function MorePage() {
  return (
    <div
      className="font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1180px] px-5 md:px-10 py-16 md:py-24 space-y-12">
        <header className="space-y-6">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Secondary surfaces
          </div>
          <h1
            className="font-display font-bold tracking-tight leading-[1.05]"
            style={{
              fontSize: "clamp(34px, 4.6vw, 56px)",
              letterSpacing: "-0.03em",
            }}
          >
            Everything else{" "}
            <em className="font-serif italic font-normal">we built</em>.
          </h1>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(15px, 1.2vw, 17px)",
              lineHeight: 1.65,
              color: "var(--text-secondary)",
            }}
          >
            Zerith&apos;s primary product is encrypted block sales for token
            foundations. These are the other primitives we built on the same
            FHE stack — auction variants, payroll, OTC, observability. Every
            page works; all share the same threshold network and the same
            privacy guarantees.
          </p>
        </header>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {SECONDARY_NAV.map((item) => {
            const Icon = ICON_MAP[item.icon] ?? Sparkles;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group block p-6 transition-colors"
                style={{
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-10 h-10 flex items-center justify-center shrink-0"
                    style={{
                      background: "var(--bg-alt)",
                      border: "1px dashed var(--border-dash)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <Icon size={16} style={{ color: "var(--text)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-display font-semibold mb-1.5"
                      style={{
                        fontSize: 17,
                        letterSpacing: "-0.01em",
                        color: "var(--text)",
                      }}
                    >
                      {item.label}
                    </h3>
                    <p
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {item.description}
                    </p>
                    <div
                      className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Open
                      <ArrowRight
                        size={11}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        <footer className="space-y-3">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.12em]"
            style={{ color: "var(--text-muted)" }}
          >
            — A note on scope
          </p>
          <p
            className="max-w-2xl"
            style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-secondary)" }}
          >
            We built breadth to prove FHE is generalizable across the whole
            on-chain finance stack — not just one feature. For production, we
            lead with block sales because that&apos;s where the buyer pain is
            most acute and the unit economics work today. The rest is here, it
            works, and it becomes load-bearing as the product expands.
          </p>
        </footer>
      </div>
    </div>
  );
}
