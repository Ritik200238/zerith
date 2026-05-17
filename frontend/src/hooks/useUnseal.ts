"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";
import { useWallet } from "@/providers/WalletProvider";

interface UnsealState {
  unsealing: boolean;
  error: string | null;
}

/**
 * Hook wrapping cofhejs.unseal() — decrypts a sealed ciphertext hash
 * using the current permit so only the owner can read it.
 *
 * Usage:
 * ```ts
 * const { unseal, unsealing, error } = useUnseal();
 * const value = await unseal(ctHash, FheTypes.Uint64);
 * ```
 */
export function useUnseal() {
  const { initialized } = useCofhe();
  const { account } = useWallet();
  const [state, setState] = useState<UnsealState>({
    unsealing: false,
    error: null,
  });

  const unseal = useCallback(
    async (ctHash: bigint, fheType: number): Promise<bigint | null> => {
      if (!initialized || !account) {
        setState({ unsealing: false, error: "Not initialized or no account" });
        return null;
      }

      setState({ unsealing: true, error: null });

      try {
        const { cofhejs } = await import("cofhejs/web");

        // Audit fix E4: previously this called createPermit() on EVERY unseal
        // call, prompting MetaMask sign every time the user clicked "View".
        // Now: check for an active permit first; only create one if missing.
        // CofheProvider auto-rotates permits every 23h independently.
        const existing = cofhejs.getPermit?.();
        const hasActive = existing?.success && existing?.data;
        if (!hasActive) {
          const permitResult = await cofhejs.createPermit({
            type: "self",
            issuer: account,
          });
          if (permitResult.error) {
            throw new Error("Permit creation failed: " + String(permitResult.error));
          }
        }

        const result = await cofhejs.unseal(ctHash, fheType, account);

        if (result.error) {
          throw new Error(String(result.error));
        }

        setState({ unsealing: false, error: null });
        // result.data is an UnsealedItem — its .value is the plaintext bigint
        return BigInt(result.data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unsealing failed";
        setState({ unsealing: false, error: message });
        return null;
      }
    },
    [initialized, account],
  );

  const createPermit = useCallback(async () => {
    if (!initialized || !account) return null;

    try {
      const { cofhejs } = await import("cofhejs/web");
      const result = await cofhejs.createPermit({
        type: "self",
        issuer: account,
      });

      if (result.error) {
        throw new Error(String(result.error));
      }

      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Permit creation failed";
      setState({ unsealing: false, error: message });
      return null;
    }
  }, [initialized, account]);

  return {
    unseal,
    createPermit,
    unsealing: state.unsealing,
    error: state.error,
  };
}
