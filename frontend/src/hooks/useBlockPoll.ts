"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/providers/WalletProvider";

/**
 * useBlockPoll — returns a counter that ticks once per new block.
 *
 * Audit fix E3: previously the app had ZERO polling and ZERO event listeners.
 * Multi-user demos were dead — User B never saw User A's actions until manual
 * refresh. This hook fixes that with a lightweight every-N-seconds block poll.
 *
 * Usage:
 *   const tick = useBlockPoll();
 *   useEffect(() => { fetchData(); }, [tick]);  // re-fetch on each new block
 *
 * Tick is monotonic but its absolute value is meaningless — it's just an
 * effect-dependency invalidator. Use the return value as a useEffect dep.
 *
 * Default poll interval: 12 seconds (Eth Sepolia block time ~= 12s).
 * Configurable via the intervalMs param if a feature needs tighter cadence.
 */
export function useBlockPoll(intervalMs = 12_000): number {
  const { provider } = useWallet();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    let lastBlock = -1;

    const check = async () => {
      try {
        const block = await provider.getBlockNumber();
        if (cancelled) return;
        if (block !== lastBlock) {
          lastBlock = block;
          setTick((t) => t + 1);
        }
      } catch {
        // Network blip — try again next tick
      }
    };

    // Fire one immediate check, then poll
    check();
    const id = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [provider, intervalMs]);

  return tick;
}

/**
 * useAccountChangeReset — listens for the "zerith-account-changed" event
 * dispatched by WalletProvider, calls the provided reset callback whenever
 * the user switches wallets.
 *
 * Use this on every page that holds account-scoped state (unsealed amounts,
 * cached encrypted handles, in-progress forms) to prevent leaks across
 * accounts.
 */
export function useAccountChangeReset(onReset: () => void): void {
  useEffect(() => {
    const handler = () => onReset();
    window.addEventListener("zerith-account-changed", handler);
    return () => window.removeEventListener("zerith-account-changed", handler);
  }, [onReset]);
}
