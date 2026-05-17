"use client";

/**
 * PrivacyLensToggle — global navbar control that switches the visibility mode
 * for every PrivacyLens-aware surface on the page.
 *
 * Three modes, cycled by clicking the button or selecting from the dropdown:
 *   • ME           (default) — your private view
 *   • COUNTERPARTY        — what someone you're trading with sees
 *   • OBSERVER     — what a random outside watcher sees
 *
 * The active mode persists in localStorage across page loads.
 */

import { useState, useRef, useEffect } from "react";
import { Eye, User, Users, Globe2, ChevronDown } from "lucide-react";
import { usePrivacyLens, type PrivacyMode } from "@/providers/PrivacyLensProvider";

const MODES: { value: PrivacyMode; label: string; helper: string; Icon: typeof User }[] = [
  { value: "me", label: "Me", helper: "Your private view — unsealed with your permit.", Icon: User },
  { value: "counterparty", label: "Counterparty", helper: "What a party you trade with sees.", Icon: Users },
  { value: "observer", label: "Observer", helper: "What the public chain shows. Amounts sealed.", Icon: Globe2 },
];

export function PrivacyLensToggle() {
  const { mode, setMode } = usePrivacyLens();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = MODES.find((m) => m.value === mode) ?? MODES[0];
  const ActiveIcon = active.Icon;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Privacy Lens — viewing as ${active.label}`}
        title={`Privacy Lens — viewing as ${active.label}. Click to change.`}
        className="btn btn-ghost btn-sm gap-2"
        style={{ border: "1px dashed var(--border-dash)", color: "var(--text-secondary)" }}
      >
        <Eye className="w-3 h-3" />
        <span className="mono">LENS · {active.label.toUpperCase()}</span>
        <ChevronDown className="w-3 h-3" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-72 z-50 p-2 space-y-1"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
            boxShadow: "0 8px 24px rgba(17,17,17,0.08)",
          }}
        >
          <div className="mono text-textMuted px-2 py-1">— PRIVACY LENS</div>
          {MODES.map((m) => {
            const Icon = m.Icon;
            const isActive = m.value === mode;
            return (
              <button
                key={m.value}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setMode(m.value);
                  setOpen(false);
                }}
                className="w-full flex items-start gap-3 px-3 py-2 text-left transition-colors"
                style={{
                  background: isActive ? "var(--bg-alt)" : "transparent",
                  borderRadius: 4,
                  borderLeft: isActive ? "2px solid var(--text)" : "2px solid transparent",
                }}
              >
                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--text)" }} />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-text">{m.label}</span>
                  <span className="block text-xs text-textMuted leading-snug">{m.helper}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
