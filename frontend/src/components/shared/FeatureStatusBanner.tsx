"use client";

/**
 * FeatureStatusBanner — marks "Labs" pages (listed on /more), which work on testnet
 * but aren't part of the core product. Core routes render nothing, and paused
 * routes render a PausedFeature page that explains itself.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { SECONDARY_NAV } from "@/lib/constants";

const LAB_ROUTES: readonly string[] = SECONDARY_NAV.map((i) => i.href);

export function FeatureStatusBanner() {
  const pathname = usePathname() ?? "/";
  const root = "/" + (pathname.split("/")[1] ?? "");
  if (!LAB_ROUTES.includes(root)) return null;

  return (
    <div
      role="note"
      className="mb-8 flex items-start gap-3 px-4 py-3"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
      }}
    >
      <FlaskConical size={16} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
        <strong style={{ color: "var(--text)" }}>Labs.</strong> This works on Sepolia testnet but
        isn&apos;t part of the core product. The core product is{" "}
        <Link href="/auctions" className="underline underline-offset-2" style={{ color: "var(--text)" }}>
          sealed block sales
        </Link>
        ,{" "}
        <Link href="/treasury" className="underline underline-offset-2" style={{ color: "var(--text)" }}>
          treasury
        </Link>{" "}
        and{" "}
        <Link href="/payments" className="underline underline-offset-2" style={{ color: "var(--text)" }}>
          payroll
        </Link>
        .
      </p>
    </div>
  );
}
