"use client";

import { motion } from "framer-motion";

/**
 * Loading skeleton — used while data is fetching from chain. Replaces the
 * previous "no UI" gap that left judges staring at blank cards.
 *
 * Three sizes: card (default), row, pill. All share the same shimmer
 * animation derived from a low-energy framer-motion loop.
 */

interface SkeletonProps {
  variant?: "card" | "row" | "pill";
  className?: string;
}

export function Skeleton({ variant = "card", className = "" }: SkeletonProps) {
  const base =
    "relative overflow-hidden rounded-lg bg-[var(--void-4)]/40 border border-[var(--border-subtle)]/50";
  const sizes: Record<string, string> = {
    card: "h-24 w-full",
    row: "h-12 w-full",
    pill: "h-5 w-20",
  };

  return (
    <div className={`${base} ${sizes[variant]} ${className}`}>
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
      />
    </div>
  );
}

/** Multiple skeleton cards stacked. */
export function SkeletonList({
  count = 3,
  variant = "card",
}: {
  count?: number;
  variant?: SkeletonProps["variant"];
}) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  );
}
