"use client";

import { useCofheContext } from "@/providers/CofheProvider";

/**
 * Convenience hook that exposes the @cofhe/sdk client and its state.
 * Re-exports the CofheProvider context for consistent access across the app.
 */
export function useCofhe() {
  return useCofheContext();
}
