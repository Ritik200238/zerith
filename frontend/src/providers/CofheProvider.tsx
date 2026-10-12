"use client";

/**
 * CofheProvider — the app's single @cofhe/sdk (CoFHE 1.0) client.
 *
 * Used for everything Fhenix: encrypting inputs (useEncrypt), unsealing a user's
 * own values with their self ACP (useUnseal), and Threshold-Network-signed public
 * decrypts for on-chain reveals (useDecryptForTx).
 *
 * The client is bound to one wallet account. It is rebuilt whenever the account,
 * signer or chain changes, so encrypted inputs and ACPs never belong to a wallet
 * the user has switched away from.
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

// Loose typing — the SDK ships WASM and is loaded only at runtime via dynamic import.
type CofheClient = unknown;

interface CofheState {
  /** The client is connected for the current account */
  initialized: boolean;
  initializing: boolean;
  error: string | null;
  client: CofheClient | null;
}

interface CofheContextValue extends CofheState {
  reinitialize: () => Promise<void>;
}

const CofheContext = createContext<CofheContextValue | null>(null);

export function CofheProvider({ children }: { children: React.ReactNode }) {
  const { provider, signer, account, isCorrectChain } = useWallet();

  const [state, setState] = useState<CofheState>({
    initialized: false,
    initializing: false,
    error: null,
    client: null,
  });

  // Identity the current client was built for; a mismatch means "rebuild".
  const builtForRef = useRef<string | null>(null);
  // Guards against an older init resolving after a newer one started.
  const generationRef = useRef(0);

  const identity = account && signer && isCorrectChain ? account.toLowerCase() : null;

  const init = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!provider || !signer || !identity) {
      builtForRef.current = null;
      setState({ initialized: false, initializing: false, error: null, client: null });
      return;
    }

    setState((s) => ({ ...s, initialized: false, initializing: true, error: null, client: null }));
    try {
      const [{ createCofheClient, createCofheConfig }, { Ethers6Adapter }, { chains }] =
        await Promise.all([
          import("@cofhe/sdk/web"),
          import("@cofhe/sdk/adapters"),
          import("@cofhe/sdk/chains"),
        ]);

      const client = createCofheClient(createCofheConfig({ supportedChains: [chains.sepolia] }));
      const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);
      await client.connect(publicClient, walletClient);

      if (generation !== generationRef.current) return; // superseded by a newer init
      builtForRef.current = identity;
      setState({ initialized: true, initializing: false, error: null, client });
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      builtForRef.current = null;
      setState({
        initialized: false,
        initializing: false,
        error: err instanceof Error ? err.message : "Couldn't start the encryption client",
        client: null,
      });
    }
  }, [provider, signer, identity]);

  // Build on connect, and rebuild whenever the account/signer/chain changes.
  useEffect(() => {
    if (builtForRef.current === identity && (state.initialized || state.initializing)) return;
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, signer, provider]);

  const value = useMemo<CofheContextValue>(() => ({ ...state, reinitialize: init }), [state, init]);

  return <CofheContext.Provider value={value}>{children}</CofheContext.Provider>;
}

export function useCofheContext(): CofheContextValue {
  const ctx = useContext(CofheContext);
  if (!ctx) throw new Error("useCofheContext must be used within a CofheProvider");
  return ctx;
}
