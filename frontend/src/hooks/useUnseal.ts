"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";
import { useWallet } from "@/providers/WalletProvider";

interface UnsealState {
  unsealing: boolean;
  error: string | null;
}

type CofheClient = {
  permits: {
    getOrCreateSelfPermit: () => Promise<unknown>;
    createSelf: (opts: { issuer: string; name?: string }) => Promise<unknown>;
  };
  decryptForView: (
    ctHash: bigint,
    fheType: number,
  ) => { execute: () => Promise<bigint | { decryptedValue: bigint }> };
};

/**
 * Hook wrapping @cofhe/sdk client.decryptForView(...) — decrypts a sealed
 * ciphertext hash using the current permit so only the owner can read it.
 *
 * Usage:
 * ```ts
 * const { unseal, unsealing, error } = useUnseal();
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
        setState({ unsealing: false, error: "Not initialized or no account" });
        return null;
      }

      setState({ unsealing: true, error: null });

      try {
        const c = client as CofheClient;
        // Make sure an active self-permit exists (idempotent in new SDK).
        await c.permits.getOrCreateSelfPermit();

        const result = await c.decryptForView(ctHash, fheType).execute();
        setState({ unsealing: false, error: null });

        // New SDK can return either the bigint directly or an envelope.
        if (typeof result === "bigint") return result;
        const envelope = result as { decryptedValue?: bigint; value?: bigint };
        return BigInt(envelope.decryptedValue ?? envelope.value ?? 0);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unsealing failed";
        setState({ unsealing: false, error: message });
        return null;
      }
    },
    [initialized, client, account],
  );

  const createPermit = useCallback(async () => {
    if (!initialized || !client || !account) return null;

    try {
      const c = client as CofheClient;
      return await c.permits.createSelf({ issuer: account, name: "Zerith" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Permit creation failed";
      setState({ unsealing: false, error: message });
      return null;
    }
  }, [initialized, client, account]);

  return {
    unseal,
    createPermit,
    unsealing: state.unsealing,
    error: state.error,
  };
}
