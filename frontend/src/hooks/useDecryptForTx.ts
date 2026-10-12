"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";

/**
 * useDecryptForTx — verifiable on-chain reveal hook.
 *
 * Asks the Threshold Network to decrypt a handle and returns
 * { ctHash, decryptedValue, signature }. Contracts verify the signature with
 * FHE.publishDecryptResult, so anyone (not just the original requester) can
 * submit the reveal.
 *
 * Default is `withoutACP()` — for handles the contract made publicly decryptable
 * (FHE.allowGlobal / allowPublic), e.g. auction outcomes after close. Pass
 * `{ withACP: true }` for handles only the connected account may decrypt.
 */

interface DecryptForTxResult {
  ctHash: bigint | string;
  decryptedValue: bigint;
  signature: `0x${string}`;
}

interface DecryptForTxState {
  decrypting: boolean;
  error: string | null;
  result: DecryptForTxResult | null;
}

type Selected = { execute: () => Promise<DecryptForTxResult> };
type ClientLike = {
  decryptForTx: (ctHash: bigint | string) => {
    withoutACP: () => Selected;
    withACP: () => Selected;
  };
};

export function useDecryptForTx() {
  const { client, initialized } = useCofhe();
  const [state, setState] = useState<DecryptForTxState>({
    decrypting: false,
    error: null,
    result: null,
  });

  const decrypt = useCallback(
    async (
      ctHash: bigint | string,
      options: { withACP?: boolean } = {},
    ): Promise<DecryptForTxResult | null> => {
      if (!initialized || !client) {
        setState({ decrypting: false, error: "Encryption client not ready", result: null });
        return null;
      }
      setState({ decrypting: true, error: null, result: null });
      try {
        const builder = (client as ClientLike).decryptForTx(ctHash);
        const result = await (options.withACP ? builder.withACP() : builder.withoutACP()).execute();
        setState({ decrypting: false, error: null, result });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "decryptForTx failed";
        console.error("[useDecryptForTx] failed for ctHash", ctHash, ":", err);
        setState({ decrypting: false, error: message, result: null });
        return null;
      }
    },
    [client, initialized],
  );

  const reset = useCallback(() => {
    setState({ decrypting: false, error: null, result: null });
  }, []);

  return {
    decrypt,
    reset,
    decrypting: state.decrypting,
    error: state.error,
    result: state.result,
  };
}
