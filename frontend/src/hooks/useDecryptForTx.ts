"use client";

import { useCallback, useState } from "react";
import { useCofhe2Context } from "@/providers/Cofhe2Provider";

/**
 * useDecryptForTx — verifiable on-chain reveal hook.
 *
 * Calls @cofhe/sdk's decryptForTx builder, which submits to the Threshold
 * Network and returns { ctHash, decryptedValue, signature }. Signature is
 * verified on-chain by FHE.publishDecryptResult, so any caller (not just
 * the original requester) can trigger the reveal.
 *
 * Pair with .withoutPermit() when the contract has called FHE.allowGlobal /
 * FHE.allowPublic on the handle (e.g. auction winners after closeAuction).
 * Use .withPermit() when ACL is per-account.
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

type ClientLike = {
  decryptForTx: (ctHash: bigint | string) => {
    withoutPermit: () => { execute: () => Promise<DecryptForTxResult> };
    withPermit: (permit?: unknown) => { execute: () => Promise<DecryptForTxResult> };
  };
};

export function useDecryptForTx() {
  const { client, initialized } = useCofhe2Context();
  const [state, setState] = useState<DecryptForTxState>({
    decrypting: false,
    error: null,
    result: null,
  });

  const decrypt = useCallback(
    async (
      ctHash: bigint | string,
      options: { withPermit?: boolean } = { withPermit: false },
    ): Promise<DecryptForTxResult | null> => {
      if (!initialized || !client) {
        setState({ decrypting: false, error: "Cofhe2 not initialized", result: null });
        return null;
      }

      setState({ decrypting: true, error: null, result: null });

      try {
        const c = client as ClientLike;
        const builder = c.decryptForTx(ctHash);
        const flow = options.withPermit ? builder.withPermit() : builder.withoutPermit();
        const result = await flow.execute();

        setState({ decrypting: false, error: null, result });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "decryptForTx failed";
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
