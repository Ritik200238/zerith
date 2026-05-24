"use client";

/**
 * EmptyState — editorial empty-state block with one primary CTA.
 *
 * Use anywhere a list/grid can legitimately have zero items (no auctions,
 * no quotes, no orders). Replaces the previous pattern of either rendering
 * nothing or a tiny "no items yet" string, both of which leave the page
 * feeling broken to a new visitor.
 *
 * Matches the editorial design vocabulary:
 *   - dashed border
 *   - mono uppercase eyebrow
 *   - display headline
 *   - body copy
 *   - primary button + optional secondary
 */

import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

interface Action {
  label: string;
  onClick?: () => void;
  href?: string;
}

interface Props {
  /** Small uppercase mono eyebrow above the headline. e.g. "No sealed auctions yet" */
  eyebrow?: string;
  /** Display-font headline. e.g. "Be the first to seal a bid." */
  title: string;
  /** Optional body copy under the headline. */
  body?: string;
  /** Primary call-to-action. */
  primary?: Action;
  /** Optional secondary action (rendered as a quiet link). */
  secondary?: Action;
  /** Optional icon shown above the eyebrow. */
  icon?: LucideIcon;
}

export function EmptyState({ eyebrow, title, body, primary, secondary, icon: Icon }: Props) {
  return (
    <div
      className="flex flex-col items-start gap-4 px-6 py-12 md:px-10 md:py-16"
      style={{
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
        background: "var(--bg-card)",
      }}
    >
      {Icon && (
        <div
          className="w-10 h-10 flex items-center justify-center"
          style={{
            background: "var(--bg-alt)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
          }}
        >
          <Icon size={18} style={{ color: "var(--text)" }} />
        </div>
      )}

      {eyebrow && (
        <p
          className="font-mono uppercase tracking-[0.12em]"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          — {eyebrow}
        </p>
      )}

      <h3
        className="font-display font-bold tracking-tight"
        style={{
          fontSize: "clamp(22px, 2.6vw, 30px)",
          letterSpacing: "-0.02em",
          color: "var(--text)",
          lineHeight: 1.15,
          maxWidth: 520,
        }}
      >
        {title}
      </h3>

      {body && (
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            maxWidth: 520,
          }}
        >
          {body}
        </p>
      )}

      {(primary || secondary) && (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {primary &&
            (primary.href ? (
              <a
                href={primary.href}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {primary.label} <ArrowRight size={13} />
              </a>
            ) : (
              <button
                type="button"
                onClick={primary.onClick}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {primary.label} <ArrowRight size={13} />
              </button>
            ))}

          {secondary &&
            (secondary.href ? (
              <a
                href={secondary.href}
                className="inline-flex items-center gap-1 text-sm font-medium transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                {secondary.label} <ArrowRight size={12} />
              </a>
            ) : (
              <button
                type="button"
                onClick={secondary.onClick}
                className="inline-flex items-center gap-1 text-sm font-medium transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                {secondary.label} <ArrowRight size={12} />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
