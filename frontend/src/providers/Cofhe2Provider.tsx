"use client";

/**
 * Cofhe2Provider — second @cofhe/sdk client instance, dedicated to the
 * verifiable on-chain reveal (decryptForTx) path.
 *
 * NOTE: this is NOT a different SDK from CofheProvider. Both providers import
 * the SAME @cofhe/sdk (web / adapters / chains) — there is no legacy
 * cofhejs@0.3.1 here; nothing in src/ imports cofhejs. They run in parallel
 * only to keep two concerns on separate client instances. The real
 * differences are:
 *
 *  1. Chain set. CofheProvider configures supportedChains: [sepolia] only.
 *     This provider also lists arbSepolia + baseSepolia for future
 *     multi-chain expansion (see config below).
 *
 *  2. Decrypt model (the load-bearing split):
 *     - CofheProvider's client is consumed via useCofhe → useUnseal, which
 *       calls client.decryptForView(...) — a permit-gated, owner-only VIEW
 *       read — and owns the 23h self-permit auto-rotation.
 *     - THIS client is consumed via useDecryptForTx, which calls
 *       client.decryptForTx(...). That returns a Threshold Network signature
 *       contracts verify via FHE.publishDecryptResult, so any caller can
 *       trigger the reveal — the verifiable on-chain reveal pattern. No
 *       permit-rotation effect lives here.
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

      const client = createCofheClient(config);
      // P0 fix: the SDK's chainId+account internal state is wired by the
      // explicit .connect(publicClient, walletClient) call — the one-shot
      // constructor form leaves the client in an "unconnected" state that
      // throws 'Client must be connected, account and chainId must be
      // initialized' from decryptForTx. The Node SDK adapter docs use the
      // .connect() pattern; matching it here so the browser hook behaves
      // identically to the Hardhat reveal path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).connect(publicClient, walletClient);

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
