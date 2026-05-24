"use client";

/**
 * useTxFlow — minimal state machine for the 4-step encrypted-action UI.
 *
 * Encapsulates the boilerplate every encrypted-write handler used to inline
 * (idle/encrypt/submit/confirm/sealed/error + tx hash + error message). Pages
 * just call the transition methods at the right points in their async flow:
 *
 *   const bidFlow = useTxFlow();
 *   const handleBid = async () => {
 *     bidFlow.begin();                  // → "encrypt"
 *     const enc = await encrypt(...);
 *     bidFlow.submitted();              // → "submit"
 *     const tx = await contract.bid(...);
 *     bidFlow.confirmed(tx.hash);       // → "confirm"
 *     await tx.wait();
 *     bidFlow.sealed();                 // → "sealed"
 *   };
 *
 * Errors land via `bidFlow.failed(err)` which writes a humanized message and
 * flips the drawer to its error/retry panel. Closing the drawer resets to idle.
 */

import { useCallback, useMemo, useState } from "react";
import type { TxFlowStep } from "@/components/shared/TxFlowDrawer";

export interface TxFlow {
  step: TxFlowStep;
  errorMessage: string | undefined;
  txHash: string | undefined;
  /** Move to "encrypt" — call BEFORE the cofhejs encrypt() promise. */
  begin: () => void;
  /** Move to "submit" — call BEFORE the contract write awaits the wallet. */
  submitted: () => void;
  /** Move to "confirm" — call once the contract write returns a tx object. */
  confirmed: (txHash: string) => void;
  /** Terminal success step. Call after `tx.wait()` resolves. */
  sealed: () => void;
  /** Terminal error state. Accepts any thrown value and humanizes it. */
  failed: (err: unknown) => void;
  /** Reset to idle (closes the drawer). */
  close: () => void;
  /** True only while a flow is in flight (not idle / sealed / error). */
  isInFlight: boolean;
}

export function useTxFlow(): TxFlow {
  const [step, setStep] = useState<TxFlowStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<string | undefined>();

  const begin = useCallback(() => {
    setStep("encrypt");
    setErrorMessage(undefined);
    setTxHash(undefined);
  }, []);

  const submitted = useCallback(() => setStep("submit"), []);

  const confirmed = useCallback((hash: string) => {
    setStep("confirm");
    setTxHash(hash);
  }, []);

  const sealed = useCallback(() => setStep("sealed"), []);

  const failed = useCallback((err: unknown) => {
    const isRejection =
      err instanceof Error && err.message.toLowerCase().includes("user rejected");
    const raw =
      err instanceof Error ? err.message : "Transaction failed";
    setStep("error");
    setErrorMessage(
      isRejection ? "You rejected the transaction in your wallet" : raw.slice(0, 240),
    );
  }, []);

  const close = useCallback(() => {
    setStep("idle");
    setErrorMessage(undefined);
    setTxHash(undefined);
  }, []);

  return useMemo(
    () => ({
      step,
      errorMessage,
      txHash,
      begin,
      submitted,
      confirmed,
      sealed,
      failed,
      close,
      isInFlight: step !== "idle" && step !== "sealed" && step !== "error",
    }),
    [step, errorMessage, txHash, begin, submitted, confirmed, sealed, failed, close],
  );
}
