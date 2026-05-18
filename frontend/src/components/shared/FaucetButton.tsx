"use client";

import { useState, useCallback } from "react";
import { useContract } from "@/hooks/useContract";
import { useWallet } from "@/providers/WalletProvider";
import { useToast } from "@/components/shared/Toast";
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
      const errorMsg = err instanceof Error ? err.message : "Faucet request failed";
      const isRejection = errorMsg.includes("user rejected");
      toast.error(
        isRejection ? "Faucet cancelled" : "Faucet failed",
        isRejection ? "Transaction rejected — try again any time" : "Network or contract error — try again",
      );
      setTimeout(() => setStatus("idle"), 4000);
    }
  }, [tokenContract, account, toast]);

  // Disconnected → still render, prompt connect.
  if (!account) {
    return (
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
