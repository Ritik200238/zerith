"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";

/**
 * Encryption stages reported by the @cofhe/sdk client during encryptInputs.
 * Matches the EncryptStep enum.
 */
export type EncryptStage =
  | "idle"
  | "extract"
  | "pack"
  | "prove"
  | "verify"
  | "replace"
  | "done"
  | "error";

interface EncryptState {
  stage: EncryptStage;
  encrypting: boolean;
  error: string | null;
}

type CofheClient = {
  encryptInputs: (items: unknown[]) => {
    onStep: (cb: (step: string) => void) => {
      execute: () => Promise<unknown[]>;
    };
    execute: () => Promise<unknown[]>;
  };
};

/**
 * Hook wrapping @cofhe/sdk client.encryptInputs(...).execute() with progress.
 *
 * Usage:
 * ```ts
 * const { encrypt, stage, encrypting, error } = useEncrypt();
 * const [encPrice] = await encrypt([Encryptable.uint128(price)]) ?? [];
 * ```
 */
export function useEncrypt() {
  const { initialized, client } = useCofhe();
  const [state, setState] = useState<EncryptState>({
    stage: "idle",
    encrypting: false,
    error: null,
  });

  const encrypt = useCallback(
    async <T extends unknown[]>(items: [...T]) => {
      if (!initialized || !client) {
        setState({ stage: "error", encrypting: false, error: "cofhe client not initialized" });
        return null;
      }

      setState({ stage: "extract", encrypting: true, error: null });

      try {
        const c = client as CofheClient;
        const result = await c
          .encryptInputs(items as unknown[])
          .onStep((step) => {
            setState((prev) => ({ ...prev, stage: step as EncryptStage }));
          })
          .execute();

        setState({ stage: "done", encrypting: false, error: null });
        return result as T;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Encryption failed";
        setState({ stage: "error", encrypting: false, error: message });
        return null;
      }
    },
    [initialized, client],
  );

  const reset = useCallback(() => {
    setState({ stage: "idle", encrypting: false, error: null });
  }, []);

  return {
    encrypt,
    reset,
    stage: state.stage,
    encrypting: state.encrypting,
    error: state.error,
  };
}
