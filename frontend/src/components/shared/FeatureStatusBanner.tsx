"use client";

/**
 * FeatureStatusBanner — tells visitors which pages are the core product and
 * which are not ready for real value.
 *
 * Core routes render nothing. "Labs" routes are listed on /more and work on
 * testnet with known issues. Every other feature route is "paused": the page
 * still loads, but the feature is being reworked and isn't advertised.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, PauseCircle } from "lucide-react";
import { CORE_ROUTES, SECONDARY_NAV } from "@/lib/constants";

const LAB_ROUTES: readonly string[] = SECONDARY_NAV.map((i) => i.href);

function statusFor(pathname: string): "core" | "labs" | "paused" {
  const root = "/" + (pathname.split("/")[1] ?? "");
  if ((CORE_ROUTES as readonly string[]).includes(root)) return "core";
  if (LAB_ROUTES.includes(root)) return "labs";
  return "paused";
}

export function FeatureStatusBanner() {
  const pathname = usePathname() ?? "/";
  const status = statusFor(pathname);
  if (status === "core") return null;

  const isLabs = status === "labs";
  const Icon = isLabs ? FlaskConical : PauseCircle;

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
      <Icon size={16} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
        <strong style={{ color: "var(--text)" }}>{isLabs ? "Labs." : "Paused."}</strong>{" "}
        {isLabs
          ? "This feature works on Sepolia testnet but has known issues and isn't ready for real value."
          : "This feature is being reworked. You can look around, but don't rely on it yet."}{" "}
        The core product is{" "}
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
