"use client";

import type { HTMLAttributes, ReactNode } from "react";

export interface SectionLabelProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * Zerith editorial section label. Mono uppercase with an em-dash prefix
 * supplied by the `.section-label` CSS class.
 *
 *   <SectionLabel>PRIVACY ARCHITECTURE</SectionLabel>
 *
 * Renders as:  "— PRIVACY ARCHITECTURE"
 */
export function SectionLabel({ children, className = "", ...rest }: SectionLabelProps) {
  return (
    <span className={`section-label ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
