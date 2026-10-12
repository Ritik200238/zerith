"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";

/**
 * Encryption stages shown by EncryptionProgress. The SDK's own steps
 * (initTfhe, fetchKeys, pack, prove, verify) are mapped onto these.
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

const STEP_TO_STAGE: Record<string, EncryptStage> = {
  initTfhe: "extract",
  fetchKeys: "extract",
  pack: "pack",
  prove: "prove",
  verify: "verify",
};

type Builder = {
  setConsumingContract: (address: string) => Builder;
  onStep: (cb: (step: string, ctx?: { isEnd?: boolean }) => void) => Builder;
  execute: () => Promise<string[]>;
};
type CofheClient = { encryptInputs: (items: unknown[]) => Builder };

/** CoFHE 1.0 encrypted inputs: one handle per item plus one batch signature. */
export interface EncryptedBatch {
  handles: string[];
  signature: string;
}

/**
 * Hook wrapping @cofhe/sdk client.encryptInputs(...) with progress.
 *
 * Every input is bound to the contract that will consume it, so callers must say
 * which contract they're sending to. The result maps straight onto contract args:
 *
 * ```ts
 * const { encrypt } = useEncrypt();
 * const enc = await encrypt([Encryptable.uint64(amount)], CONTRACTS.SettlementVault);
 * if (enc) await vault.deposit(token, enc.handles[0], enc.signature);
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
    async (items: unknown[], consumingContract?: string): Promise<EncryptedBatch | null> => {
      if (!initialized || !client) {
        setState({ stage: "error", encrypting: false, error: "Encryption client not ready" });
        return null;
      }
      if (!consumingContract) {
        // Only paused features call without a target; their contracts predate
        // CoFHE 1.0 and can't accept current encrypted inputs.
        setState({
          stage: "error",
          encrypting: false,
          error: "This feature is paused: its contract doesn't accept the current Fhenix encryption format.",
        });
        return null;
      }
      setState({ stage: "extract", encrypting: true, error: null });
      try {
        const out = await (client as CofheClient)
          .encryptInputs(items)
          .setConsumingContract(consumingContract)
          .onStep((step) => {
            const stage = STEP_TO_STAGE[step];
            if (stage) setState((prev) => ({ ...prev, stage }));
          })
          .execute();
        setState({ stage: "done", encrypting: false, error: null });
        return { handles: out.slice(0, -1), signature: out[out.length - 1] };
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
