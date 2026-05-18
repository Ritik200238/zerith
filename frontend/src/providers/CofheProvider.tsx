"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "./WalletProvider";

/* ---------- Types ---------- */

// Loose typing — the SDK's full types load only at runtime via dynamic import.
type CofheClient = unknown;

interface CofheState {
  /** Whether the cofhe client is connected for the current signer */
  initialized: boolean;
  /** Initialization is in progress */
  initializing: boolean;
  /** Last initialization error */
  error: string | null;
  /** The active @cofhe/sdk client. Null until initialized. */
  client: CofheClient | null;
}

interface CofheContextValue extends CofheState {
  reinitialize: () => Promise<void>;
}

const CofheContext = createContext<CofheContextValue | null>(null);

/* ---------- Provider ---------- */

export function CofheProvider({ children }: { children: React.ReactNode }) {
  const { provider, signer, account, isCorrectChain } = useWallet();

  const [initialized, setInitialized] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<CofheClient | null>(null);

  // Track which account we initialized for so we re-init on switch
  const initializedForRef = useRef<string | null>(null);

  const doInit = useCallback(async () => {
    if (!provider || !signer || !account || !isCorrectChain) {
      setInitialized(false);
      setClient(null);
      return;
    }

    // Already initialized for this account
    if (initializedForRef.current === account && initialized) return;

    setInitializing(true);
    setError(null);

    try {
      // Dynamic imports — @cofhe/sdk ships WASM and must only run client-side.
      const [{ createCofheClient, createCofheConfig }, { Ethers6Adapter }, { chains }] =
        await Promise.all([
          import("@cofhe/sdk/web"),
          import("@cofhe/sdk/adapters"),
          import("@cofhe/sdk/chains"),
        ]);

      const cfg = createCofheConfig({
        supportedChains: [chains.sepolia],
      });
      const c = createCofheClient(cfg);

      const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);
      await c.connect(publicClient, walletClient);

      initializedForRef.current = account;
      setClient(c);
      setInitialized(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "cofhe client init failed";
      setError(message);
      setInitialized(false);
      setClient(null);
    } finally {
      setInitializing(false);
    }
  }, [provider, signer, account, isCorrectChain, initialized]);

  // Auto-initialize when wallet connects or account changes
  useEffect(() => {
    if (account && isCorrectChain && !initialized && !initializing) {
      doInit();
    }
  }, [account, isCorrectChain, initialized, initializing, doInit]);

  // Reset when wallet disconnects
  useEffect(() => {
    if (!account) {
      setInitialized(false);
      setClient(null);
      setError(null);
      initializedForRef.current = null;
    }
  }, [account]);

  // Auto-rotate permit every 23 hours (permits last 24h).
  // New SDK manages permits through client.permits.
  useEffect(() => {
    if (!initialized || !client || !account) return;
    const c = client as { permits?: { getOrCreateSelfPermit?: () => Promise<unknown> } };
    if (!c.permits?.getOrCreateSelfPermit) return;

    const interval = setInterval(async () => {
      try {
        await c.permits!.getOrCreateSelfPermit!();
      } catch {
        // Permit refresh failed — will retry on next interval or next unseal
      }
    }, 23 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [initialized, client, account]);

  const value = useMemo<CofheContextValue>(
    () => ({
      initialized,
      initializing,
      error,
      client,
      reinitialize: doInit,
    }),
    [initialized, initializing, error, client, doInit],
  );

  return <CofheContext.Provider value={value}>{children}</CofheContext.Provider>;
}

/* ---------- Hook ---------- */

export function useCofheContext(): CofheContextValue {
  const ctx = useContext(CofheContext);
  if (!ctx) {
    throw new Error("useCofheContext must be used within a CofheProvider");
  }
  return ctx;
}
