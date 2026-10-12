"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";
import { useWallet } from "@/providers/WalletProvider";

interface UnsealState {
  unsealing: boolean;
  error: string | null;
}

type CofheClient = {
  acp: {
    getOrCreateSelfACP: () => Promise<unknown>;
    createSelf: (opts: { issuer: string; name?: string }) => Promise<unknown>;
  };
  decryptForView: (
    ctHash: bigint,
    fheType: number,
  ) => { withACP: () => { execute: () => Promise<bigint | boolean | string> } };
};

/**
 * Hook wrapping @cofhe/sdk client.decryptForView(...) — decrypts a ciphertext the
 * connected account is allowed to read, using its self ACP (Access Control
 * Permission, the CoFHE 1.0 replacement for permits). The first unseal asks the
 * wallet to sign the ACP once; later unseals reuse it.
 *
 * Usage:
 * ```ts
 * const { unseal } = useUnseal();
 * const value = await unseal(ctHash, FheTypes.Uint64);
 * ```
 */
export function useUnseal() {
  const { initialized, client } = useCofhe();
  const { account } = useWallet();
  const [state, setState] = useState<UnsealState>({
    unsealing: false,
    error: null,
  });

  const unseal = useCallback(
    async (ctHash: bigint, fheType: number): Promise<bigint | null> => {
      if (!initialized || !client || !account) {
        setState({ unsealing: false, error: "Connect a wallet first" });
        return null;
      }
      setState({ unsealing: true, error: null });
      try {
        const c = client as CofheClient;
        await c.acp.getOrCreateSelfACP();
        const value = await c.decryptForView(ctHash, fheType).withACP().execute();
        setState({ unsealing: false, error: null });
        if (typeof value === "bigint") return value;
        if (typeof value === "boolean") return value ? BigInt(1) : BigInt(0);
        return BigInt(value);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unsealing failed";
        setState({ unsealing: false, error: message });
        return null;
      }
    },
    [initialized, client, account],
  );

  /** Explicitly create a fresh self ACP (e.g. from an "access" settings panel). */
  const createACP = useCallback(async () => {
    if (!initialized || !client || !account) return null;
    try {
      return await (client as CofheClient).acp.createSelf({ issuer: account, name: "Zerith" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Couldn't create the access permission";
      setState({ unsealing: false, error: message });
      return null;
    }
  }, [initialized, client, account]);

  return {
    unseal,
    createACP,
    unsealing: state.unsealing,
    error: state.error,
  };
}
