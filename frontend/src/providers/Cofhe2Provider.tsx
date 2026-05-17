"use client";

/**
 * Cofhe2Provider — initializes the new @cofhe/sdk@0.5+ client.
 *
 * Runs in PARALLEL with the legacy CofheProvider (cofhejs@0.3.1).
 * Both can be active at once — features migrate to this one as they're piloted.
 *
 * The new SDK exposes the explicit decryptForView / decryptForTx model.
 * decryptForTx returns a Threshold Network signature that contracts verify
 * via FHE.publishDecryptResult — the verifiable on-chain reveal pattern
 * shipped in @cofhe/sdk@0.4 and stabilized in @cofhe/sdk@0.5.
 */

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

type CofheClient = unknown; // dynamic import — avoid pulling SDK types into SSR

interface Cofhe2State {
  initialized: boolean;
  initializing: boolean;
  error: string | null;
  client: CofheClient | null;
}

interface Cofhe2ContextValue extends Cofhe2State {
  reinitialize: () => Promise<void>;
}

const Cofhe2Context = createContext<Cofhe2ContextValue | null>(null);

export function Cofhe2Provider({ children }: { children: React.ReactNode }) {
  const { provider, signer, account, isCorrectChain } = useWallet();

  const [state, setState] = useState<Cofhe2State>({
    initialized: false,
    initializing: false,
    error: null,
    client: null,
  });

  const initializedForRef = useRef<string | null>(null);

  const doInit = useCallback(async () => {
    if (!provider || !signer || !account || !isCorrectChain) {
      setState((s) => ({ ...s, initialized: false, client: null }));
      return;
    }

    if (initializedForRef.current === account && state.initialized) return;

    setState((s) => ({ ...s, initializing: true, error: null }));

    try {
      const [{ createCofheClient, createCofheConfig }, { Ethers6Adapter }, chains] =
        await Promise.all([
          import("@cofhe/sdk/web"),
          import("@cofhe/sdk/adapters"),
          import("@cofhe/sdk/chains"),
        ]);

      const { publicClient, walletClient } = await Ethers6Adapter(
        provider,
        signer,
      );

      const config = createCofheConfig({
        // Eth Sepolia is the canonical deployment chain (chainId 11155111).
        // Arb + Base Sepolia listed for future multi-chain expansion.
        supportedChains: [chains.sepolia, chains.arbSepolia, chains.baseSepolia],
      });

      const client = createCofheClient({
        ...config,
        publicClient,
        walletClient,
      });

      initializedForRef.current = account;
      setState({ initialized: true, initializing: false, error: null, client });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Cofhe2 init failed";
      setState({ initialized: false, initializing: false, error: message, client: null });
    }
  }, [provider, signer, account, isCorrectChain, state.initialized]);

  useEffect(() => {
    if (account && isCorrectChain && !state.initialized && !state.initializing) {
      doInit();
    }
  }, [account, isCorrectChain, state.initialized, state.initializing, doInit]);

  useEffect(() => {
    if (!account) {
      setState({ initialized: false, initializing: false, error: null, client: null });
      initializedForRef.current = null;
    }
  }, [account]);

  const value = useMemo<Cofhe2ContextValue>(
    () => ({
      ...state,
      reinitialize: doInit,
    }),
    [state, doInit],
  );

  return <Cofhe2Context.Provider value={value}>{children}</Cofhe2Context.Provider>;
}

export function useCofhe2Context(): Cofhe2ContextValue {
  const ctx = useContext(Cofhe2Context);
  if (!ctx) {
    throw new Error("useCofhe2Context must be used within a Cofhe2Provider");
  }
  return ctx;
}
