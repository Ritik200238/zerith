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
import { id } from "ethers";
import type { TxFlowStep } from "@/components/shared/TxFlowDrawer";

/**
 * Plain-English text for the custom errors our contracts (and FHERC20) revert
 * with. Keyed by error name; the selector table below is derived from the
 * signatures so a revert decodes even when the caller's ABI lacks the error.
 */
const CUSTOM_ERROR_TEXT: Record<string, string> = {
  InvalidInput: "One of the values you entered isn't accepted by the contract. Check the amounts and dates, then retry.",
  InvalidState: "This item isn't in the right stage for that action — it may have closed, been settled, or not started yet. Refresh to see its current status.",
  Expired: "This has already ended, so it no longer accepts that action.",
  NotOpen: "This isn't open right now.",
  NotActive: "This is no longer active.",
  NotClosed: "This hasn't closed yet. Wait for the deadline, then retry.",
  TooEarly: "It's too early for this action. Wait until the deadline has passed.",
  NotRevealed: "The result hasn't been revealed yet. Reveal it first, then retry.",
  Unauthorized: "Your wallet isn't allowed to do this. Only the creator or an approved account can.",
  NotCreator: "Only the creator can do this.",
  NotAdmin: "Only the admin can do this.",
  NotWinner: "Only the winner can do this.",
  NotRecipient: "Only the recipient can do this.",
  NotPayer: "Only the payer can do this.",
  NotMember: "Your wallet isn't a member here.",
  Paused: "This feature is paused right now.",
  PlatformPaused: "The platform is paused right now.",
  AlreadyClaimed: "This has already been claimed.",
  AlreadyVoted: "You've already voted on this.",
  AmountTooLarge: "That amount is larger than the contract allows.",
  FHERC20UnauthorizedSpender: "The vault isn't authorized to move your tokens yet. Approve the one-time vault authorization, then retry.",
  FHERC20UnauthorizedUseOfEncryptedAmount: "Your wallet isn't allowed to use that encrypted amount. Re-enter the amount and retry.",
};

const SELECTOR_TO_ERROR: Record<string, string> = Object.fromEntries(
  [
    "InvalidInput()", "InvalidState()", "Expired()", "NotOpen()", "NotActive()", "NotClosed()",
    "TooEarly()", "NotRevealed()", "Unauthorized()", "NotCreator()", "NotAdmin()", "NotWinner()",
    "NotRecipient()", "NotPayer()", "NotMember()", "Paused()", "PlatformPaused()",
    "AlreadyClaimed()", "AlreadyVoted()", "AmountTooLarge()",
    "FHERC20UnauthorizedSpender(address,address)",
    "FHERC20UnauthorizedUseOfEncryptedAmount(uint256,address)",
  ].map((sig) => [id(sig).slice(0, 10), sig.slice(0, sig.indexOf("("))]),
);

/** Dig the revert's custom-error name out of whatever shape ethers/the wallet threw. */
function customErrorName(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown> & {
    revert?: { name?: string };
    info?: { error?: { data?: unknown } };
    error?: { data?: unknown };
  };
  if (e.revert?.name && CUSTOM_ERROR_TEXT[e.revert.name]) return e.revert.name;
  for (const data of [e.data, e.info?.error?.data, e.error?.data]) {
    const hex = typeof data === "string" ? data : (data as { data?: unknown } | undefined)?.data;
    if (typeof hex === "string" && hex.length >= 10) {
      const name = SELECTOR_TO_ERROR[hex.slice(0, 10).toLowerCase()];
      if (name) return name;
    }
  }
  const msg = err instanceof Error ? err.message : "";
  return Object.keys(CUSTOM_ERROR_TEXT).find((n) => msg.includes(`${n}(`));
}

/**
 * Turn a raw thrown value (ethers revert, RPC error, wallet rejection) into one
 * plain-English sentence a non-crypto treasurer can act on. Falls back to a
 * truncated raw message so we never hide a real, unmapped error.
 *
 * Network/nonce errors can happen AFTER a transaction was broadcast, so those
 * messages never promise that nothing was sent.
 */
export function humanizeTxError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Transaction failed";
  const low = raw.toLowerCase();
  const code = (err as { code?: unknown } | null)?.code;
  if (
    code === "ACTION_REJECTED" ||
    code === 4001 ||
    low.includes("user rejected") ||
    low.includes("user denied") ||
    low.includes("rejected the request")
  )
    return "You cancelled the signature in your wallet — nothing was sent.";
  if (code === "INSUFFICIENT_FUNDS" || low.includes("insufficient funds") || low.includes("insufficient balance for"))
    return "Your wallet doesn't have enough Sepolia ETH to pay for gas. Add some ETH, then retry.";
  const custom = customErrorName(err);
  if (custom) return CUSTOM_ERROR_TEXT[custom];
  if (code === "NONCE_EXPIRED" || low.includes("nonce"))
    return "Your wallet's transaction count got out of sync. Check your recent activity first — the transaction may already have gone through — then retry.";
  if (
    code === "NETWORK_ERROR" ||
    code === "TIMEOUT" ||
    low.includes("could not coalesce") ||
    low.includes("network") ||
    low.includes("timeout") ||
    low.includes("failed to fetch")
  )
    return "Couldn't reach the network. If a transaction link appeared above, check it on Etherscan before retrying so you don't send it twice.";
  return raw.slice(0, 200);
}

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
    setStep("error");
    setErrorMessage(humanizeTxError(err));
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
