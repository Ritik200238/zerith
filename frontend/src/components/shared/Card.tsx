"use client";

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Eyebrow text rendered above the card body as a mono-uppercase label. */
  eyebrow?: ReactNode;
  /** Title rendered in display font. */
  title?: ReactNode;
  /** Compact padding (16px) instead of the default 28px. */
  compact?: boolean;
  /** Disable the hover state (e.g. for non-interactive read-only data). */
  noHover?: boolean;
}

/**
 * Zerith editorial card. Dashed border, warm white fill, 4px radius.
 * Optional eyebrow + title slots match the editorial pattern.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { eyebrow, title, compact, noHover, className = "", children, ...rest },
  ref,
) {
  const padding = compact ? "p-4" : "";
  const hover = noHover ? "hover:!border-borderDash hover:!bg-bgCard" : "";
  return (
    <div
      ref={ref}
      className={`editorial-card ${padding} ${hover} ${className}`.trim()}
      {...rest}
    >
      {eyebrow && (
        <div className="mono text-textMuted mb-3">{eyebrow}</div>
      )}
      {title && (
        <h3 className="heading-sm text-text mb-3">{title}</h3>
      )}
      {children}
    </div>
  );
});
