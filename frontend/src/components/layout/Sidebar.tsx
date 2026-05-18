"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/constants";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Gavel,
  ShieldCheck,
  Target,
  Layers,
  PieChart,
  Users,
  Star,
  Shield,
  Eye,
  TrendingDown,
  Droplets,
  CreditCard,
  Briefcase,
  Menu,
  X,
  Activity,
  Sparkles,
  Trophy,
  Calendar,
  Music,
  ListChecks,
  PackageOpen,
  Building2,
  Share2,
  Vault,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  LayoutDashboard,
  ArrowLeftRight,
  Gavel,
  ShieldCheck,
  Target,
  Layers,
  PieChart,
  Users,
  Star,
  Eye,
  TrendingDown,
  Droplets,
  CreditCard,
  Briefcase,
  Activity,
  Sparkles,
  Shield,
  Trophy,
  Calendar,
  Music,
  ListChecks,
  PackageOpen,
  Building2,
  Share2,
  Vault,
};

const GROUP_ORDER = ["Overview", "Token Launch", "Finance", "Trading", "Treasury", "Analytics", "AI"];

/**
 * Zerith editorial sidebar.
 * - Collapsed rail (68px) expands to 240px on hover
 * - Brand mark at top with serif-italic accent
 * - Group headings rendered as `— GROUP NAME` mono labels
 * - Dashed border between groups (editorial signature)
 * - Active item: dark text + 2px dark accent rail on the left
 */
export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Audit fix F1: collapse mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Audit fix F2: ESC closes mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Group nav items by their group property
  const grouped = GROUP_ORDER.map((group) => ({
    label: group,
    items: NAV_ITEMS.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      {/* Mobile menu button (visible <md only) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        className="md:hidden fixed top-3 left-3 z-50 w-10 h-10 rounded
                   bg-bgCard border border-dashed border-borderDash
                   flex items-center justify-center text-text
                   hover:bg-bgCardHover transition-colors"
      >
        <Menu size={16} />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className="md:hidden fixed inset-0 z-40 bg-text/30 backdrop-blur-sm"
        />
      )}

      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        role="navigation"
        aria-label="Primary"
        className={`
          fixed left-0 top-0 bottom-0 flex flex-col z-50
          bg-bg
          transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          ${expanded ? "w-60" : "w-[68px]"}
          ${mobileOpen ? "translate-x-0 w-60" : "-translate-x-full md:translate-x-0"}
        `}
        style={{ borderRight: "1px dashed var(--border-dash)" }}
      >
        {/* Brand mark */}
        <div
          className={`flex items-center h-16 ${expanded ? "px-5" : "px-0 justify-center"}`}
          style={{ borderBottom: "1px dashed var(--border-dash)" }}
        >
          <Link href="/" className="flex items-center gap-2.5 group min-w-0">
            <div
              className="relative w-8 h-8 rounded shrink-0 flex items-center justify-center"
              style={{ background: "var(--gradient)" }}
            >
              <Shield size={14} className="text-text drop-shadow-sm" />
            </div>
            {expanded && (
              <div className="overflow-hidden">
                <h1 className="font-display text-sm font-bold text-text tracking-tight leading-none">
                  Cipher<em className="font-serif italic font-normal">DEX</em>
                </h1>
                <p className="font-mono text-[9px] text-textMuted tracking-[0.15em] uppercase mt-1">
                  Private finance
                </p>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation sections */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {grouped.map((section, idx) => (
            <div
              key={section.label}
              className={idx > 0 && expanded ? "pt-3 mt-2" : ""}
              style={idx > 0 && expanded ? { borderTop: "1px dashed var(--border-dash)" } : undefined}
            >
              {expanded && (
                <p className="px-5 pt-1 pb-2 font-mono text-[10px] font-medium text-textMuted uppercase tracking-[0.12em]">
                  <span className="opacity-50">— </span>
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const isActive =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = ICON_MAP[item.icon];

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? item.label : undefined}
                    className={`
                      flex items-center gap-3 mx-2 rounded transition-colors duration-150 group relative
                      ${expanded ? "px-3 py-2" : "px-0 py-2 justify-center"}
                      ${isActive
                        ? "bg-bgAlt text-text"
                        : "text-textMuted hover:text-text hover:bg-bgCardHover"}
                    `}
                  >
                    {/* Active accent rail */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-text" />
                    )}

                    {Icon && (
                      <Icon
                        size={16}
                        className={`shrink-0 transition-colors ${
                          isActive ? "text-text" : "text-textMuted group-hover:text-text"
                        }`}
                      />
                    )}
                    {expanded && (
                      <span
                        className={`text-[13px] truncate ${
                          isActive ? "font-semibold text-text" : "font-medium"
                        }`}
                      >
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className={`px-3 py-3 flex items-center ${
            expanded || mobileOpen ? "justify-between" : "justify-center"
          }`}
          style={{ borderTop: "1px dashed var(--border-dash)" }}
        >
          {expanded || mobileOpen ? (
            <>
              <span className="font-mono text-[9px] text-textMuted tracking-wider uppercase">
                Powered by Fhenix
              </span>
              {mobileOpen && (
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                  className="md:hidden p-1 rounded hover:bg-bgCardHover"
                >
                  <X size={12} className="text-textMuted" />
                </button>
              )}
            </>
          ) : (
            <span className="w-1 h-1 rounded-full bg-textMuted opacity-60" />
          )}
        </div>
      </aside>
    </>
  );
}
