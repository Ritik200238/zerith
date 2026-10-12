"use client";

import { useCallback, useState } from "react";
import { useCofhe } from "./useCofhe";
import { describeCofheError } from "@/lib/cofhe-errors";

// A handle computed in the transaction just before may not be decryptable yet;
// the SDK keeps retrying until this timeout (default 10s). Lot checks and
// reveals run right after their transaction, so give them longer.
const FRESH_HANDLE_RETRY_MS = 60_000;

/**
 * useDecryptForTx — verifiable on-chain reveal hook.
 *
 * Asks the Threshold Network to decrypt a handle and returns
 * { ctHash, decryptedValue, signature }. Contracts verify the signature with
 * FHE.publishDecryptResult, so anyone (not just the original requester) can
 * submit the reveal.
 *
 * Default is `withoutACP()` — for handles the contract made publicly decryptable
 * (FHE.allowPublic), e.g. auction outcomes after close. Pass `{ withACP: true }`
 * for handles only the connected account may decrypt.
 *
 * Throws an Error with a readable message on failure.
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

type Poll = (ctx: { attemptIndex: number; elapsedMs: number }) => void;
type Selected = { execute: () => Promise<DecryptForTxResult> };
type Unset = {
  set404RetryTimeout: (ms: number) => Unset;
  onPoll: (cb: Poll) => Unset;
  withoutACP: () => Selected;
  withACP: () => Selected;
};
type ClientLike = { decryptForTx: (ctHash: bigint | string) => Unset };

export function useDecryptForTx() {
  const { client, initialized } = useCofhe();
  // How long the current request has been waiting on Fhenix (for progress text).
  const [waitedMs, setWaitedMs] = useState(0);
  const [state, setState] = useState<DecryptForTxState>({
    decrypting: false,
    error: null,
    result: null,
  });

  const decrypt = useCallback(
    async (
      ctHash: bigint | string,
      options: { withACP?: boolean } = {},
    ): Promise<DecryptForTxResult> => {
      if (!initialized || !client) {
        const message = "Encryption client not ready — connect a wallet and try again.";
        setState({ decrypting: false, error: message, result: null });
        throw new Error(message);
      }
      setState({ decrypting: true, error: null, result: null });
      setWaitedMs(0);
      try {
        const builder = (client as ClientLike)
          .decryptForTx(ctHash)
          .set404RetryTimeout(FRESH_HANDLE_RETRY_MS)
          .onPoll(({ elapsedMs }) => setWaitedMs(elapsedMs));
        const result = await (options.withACP ? builder.withACP() : builder.withoutACP()).execute();
        setState({ decrypting: false, error: null, result });
        return result;
      } catch (err: unknown) {
        const message =
          describeCofheError(err) ?? (err instanceof Error ? err.message : "Fhenix couldn't decrypt this value");
        console.error("[useDecryptForTx] failed for ctHash", ctHash, ":", err);
        setState({ decrypting: false, error: message, result: null });
        throw new Error(message);
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
    waitedMs,
  };
}
