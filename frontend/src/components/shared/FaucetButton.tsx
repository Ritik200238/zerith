"use client";

import { useState, useCallback } from "react";
import { useContract } from "@/hooks/useContract";
import { useWallet } from "@/providers/WalletProvider";
import { useToast } from "@/components/shared/Toast";
import { humanizeTxError } from "@/hooks/useTxFlow";
import { TOKEN_CONFIG, FHENIX_TESTNET } from "@/lib/constants";
import { Droplets, Loader2, Check, AlertCircle, Wallet } from "lucide-react";

type FaucetStatus = "idle" | "pending" | "confirming" | "success" | "error";

/**
 * One-click faucet button. Calls ConfidentialToken.faucet().
 *
 * Visible on EVERY page — even when the wallet is disconnected or on the
 * wrong chain. Judges must never have to hunt for tokens. When wallet is
 * absent we show "Connect to claim" which prompts the wallet connect flow.
 */
export function FaucetButton() {
  const { account, isCorrectChain, connect, connecting, switchToFhenix } = useWallet();
  const tokenContract = useContract("ConfidentialToken");
  const toast = useToast();

  const [status, setStatus] = useState<FaucetStatus>("idle");

  const handleFaucet = useCallback(async () => {
    if (!tokenContract || !account) return;
    // One claim per hour per wallet: check first instead of letting it revert.
    try {
      const last = Number(await tokenContract.lastFaucetClaim(account));
      const wait = last + 3600 - Math.floor(Date.now() / 1000);
      if (last > 0 && wait > 0) {
        toast.info(
          "Already claimed this hour",
          `The test faucet allows one claim per hour. Try again in about ${Math.ceil(wait / 60)} min.`,
        );
        return;
      }
    } catch {
      // fall through and let the transaction report any real problem
    }
    setStatus("pending");
    try {
      const tx = await tokenContract.faucet();
      setStatus("confirming");
      await tx.wait();
      setStatus("success");
      toast.success(
        `${TOKEN_CONFIG.faucetAmount} ${TOKEN_CONFIG.symbol} received`,
        "You can now bid, pay, or trade with these test tokens.",
      );
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err: unknown) {
      setStatus("error");
      const message = humanizeTxError(err);
      toast.error(message.startsWith("You cancelled") ? "Faucet cancelled" : "Faucet failed", message);
      setTimeout(() => setStatus("idle"), 4000);
    }
  }, [tokenContract, account, toast]);

  // Disconnected → still render, prompt connect.
  if (!account) {
    // Hidden on phones: it does the same as the Connect button beside it, and the
    // header has no room for both at 375px.
    return (
      <span className="hidden md:inline-flex">
      <button
        type="button"
        onClick={connect}
        disabled={connecting}
        title="Connect wallet to claim test tokens"
        aria-label="Connect wallet to claim test tokens"
        className="btn btn-outline btn-sm"
      >
        {connecting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Wallet size={14} />
        )}
        <span>{connecting ? "Connecting..." : "Connect to claim"}</span>
      </button>
      </span>
    );
  }

  // Wrong chain → prompt network switch.
  if (!isCorrectChain) {
    return (
      <button
        type="button"
        onClick={switchToFhenix}
        title={`Switch to ${FHENIX_TESTNET.name} to claim test tokens`}
        aria-label={`Switch to ${FHENIX_TESTNET.name} to claim test tokens`}
        className="btn btn-outline btn-sm"
      >
        <AlertCircle size={14} />
        <span>Wrong network</span>
      </button>
    );
  }

  const isBusy = status === "pending" || status === "confirming";

  return (
    <button
      type="button"
      onClick={handleFaucet}
      disabled={isBusy || !tokenContract}
      aria-label={`Get ${TOKEN_CONFIG.faucetAmount} test ${TOKEN_CONFIG.symbol} tokens`}
      title="Get free test tokens (one-click faucet)"
      className="btn btn-primary btn-sm"
    >
      {isBusy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : status === "success" ? (
        <Check size={14} />
      ) : status === "error" ? (
        <AlertCircle size={14} />
      ) : (
        <Droplets size={14} />
      )}
      <span className="hidden sm:inline">
        {isBusy
          ? "Processing..."
          : status === "success"
            ? "Received"
            : status === "error"
              ? "Failed — retry"
              : "Get Test Tokens"}
      </span>
      <span className="sm:hidden">
        {isBusy ? "..." : status === "success" ? "Done" : status === "error" ? "Retry" : "Tokens"}
      </span>
    </button>
  );
}
