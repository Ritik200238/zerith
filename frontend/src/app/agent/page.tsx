"use client";

/**
 * CipherDEX Agent — natural-language → encrypted tx, at /agent.
 *
 * Wave 4 WOW feature. User types a command in English; we parse, show the
 * resolved intent + the exact contract call we will make, encrypt the
 * sensitive fields, and submit. Deterministic pattern-matching parser; no
 * external LLM. Audit-friendly — every routing decision is visible before
 * the user signs.
 *
 * Supported intents (W4 scope):
 *   - pay → PrivatePayments single recipient
 *   - stream → EncryptedStreaming
 *   - bid → SealedAuction
 *   - post-job → FreelanceBidding
 *   - auction → SealedAuction.createAuction
 *
 * For each parsed intent we display the structured fields + a "Run" button.
 * Click → encrypt locally → submit.
 */

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Zap, Lock, Send, AlertCircle, CheckCircle2, Loader2, Copy, Wand2,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useContract } from "@/hooks/useContract";
import { useToast } from "@/components/shared/Toast";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { CONTRACTS } from "@/lib/constants";
import { parseAmount } from "@/lib/format";
import { parseAgentInput, EXAMPLE_COMMANDS, type Intent } from "@/lib/agent-parser";
import { FaucetButton } from "@/components/shared/FaucetButton";

export default function AgentPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const paymentsContract = useContract("PrivatePayments");
  const streamingContract = useContract("EncryptedStreaming");
  const sealedContract = useContract("SealedAuction");
  const freelanceContract = useContract("FreelanceBidding");

  const [input, setInput] = useState("");
  const intent = useMemo(() => parseAgentInput(input), [input]);

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "CipherDEX Agent", type: "system", href: "/agent", txHash });

  const handleExampleClick = (cmd: string) => setInput(cmd);

  const handleCopy = useCallback(async (intent: Intent) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(intent.fields, null, 2));
      toast.success("Copied", "Intent fields copied to clipboard");
    } catch {
      // clipboard unavailable
    }
  }, [toast]);

  /* ------------------------------------------------------------------ */
  /*  Run intent                                                         */
  /* ------------------------------------------------------------------ */

  const runIntent = useCallback(async () => {
    if (!account) {
      toast.error("Connect wallet", "You need a wallet to run agent commands");
      return;
    }
    if (!initialized) {
      toast.error("Wait", "Encryption WASM still loading");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const { Encryptable } = await import("cofhejs/web");

      switch (intent.kind) {
        case "pay": {
          if (!paymentsContract) throw new Error("PrivatePayments not deployed");
          const recipient = String(intent.fields.recipient);
          const amount = parseAmount(String(intent.fields.amount));
          if (amount === null) throw new Error("Invalid amount");
          const enc = await encrypt([Encryptable.uint64(amount)]);
          if (!enc) throw new Error("Encryption failed");
          const tx = await paymentsContract.singlePayment(
            CONTRACTS.ConfidentialToken,
            recipient,
            enc[0],
          );
          setTxState("confirming");
          setTxHash(tx.hash);
          await tx.wait();
          setTxState("success");
          break;
        }

        case "stream": {
          if (!streamingContract) {
            throw new Error("EncryptedStreaming not deployed yet — check back after deploy.");
          }
          if (CONTRACTS.EncryptedStreaming === "0x0000000000000000000000000000000000000000") {
            throw new Error("EncryptedStreaming address is zero — pending deploy.");
          }
          const recipient = String(intent.fields.recipient);
          const ratePerSecond = parseAmount(String(intent.fields.ratePerSecond));
          if (ratePerSecond === null) throw new Error("Invalid rate");
          const dur = Number(intent.fields.duration);
          const enc = await encrypt([Encryptable.uint64(ratePerSecond)]);
          if (!enc) throw new Error("Encryption failed");
          const startTime = Math.floor(Date.now() / 1000);
          const endTime = startTime + dur;
          const tx = await streamingContract.createStream(
            recipient,
            CONTRACTS.ConfidentialToken,
            enc[0],
            startTime,
            endTime,
          );
          setTxState("confirming");
          setTxHash(tx.hash);
          await tx.wait();
          setTxState("success");
          break;
        }

        case "bid": {
          if (!sealedContract) throw new Error("SealedAuction not deployed");
          const amount = parseAmount(String(intent.fields.amount));
          if (amount === null) throw new Error("Invalid amount");
          const id = Number(intent.fields.auctionId);
          const enc = await encrypt([Encryptable.uint128(amount)]);
          if (!enc) throw new Error("Encryption failed");
          const tx = await sealedContract.bid(id, enc[0]);
          setTxState("confirming");
          setTxHash(tx.hash);
          await tx.wait();
          setTxState("success");
          break;
        }

        case "post-job": {
          if (!freelanceContract) throw new Error("FreelanceBidding not deployed");
          const title = String(intent.fields.title);
          const escrow = parseAmount(String(intent.fields.escrow));
          if (escrow === null) throw new Error("Invalid escrow");
          const tx = await freelanceContract.postJob(
            title,
            escrow,
            CONTRACTS.ConfidentialToken,
            ["Final delivery"],
            [100],
          );
          setTxState("confirming");
          setTxHash(tx.hash);
          await tx.wait();
          setTxState("success");
          break;
        }

        case "auction": {
          if (!sealedContract) throw new Error("SealedAuction not deployed");
          const amount = parseAmount(String(intent.fields.amount));
          if (amount === null) throw new Error("Invalid amount");
          const tx = await sealedContract.createAuction(
            CONTRACTS.ConfidentialToken,
            CONTRACTS.ConfidentialToken,
            amount,
            BigInt(86400), // default 24h
          );
          setTxState("confirming");
          setTxHash(tx.hash);
          await tx.wait();
          setTxState("success");
          break;
        }

        default:
          throw new Error("Cannot run an unknown intent");
      }

      // clear input on success
      setInput("");
    } catch (err: unknown) {
      setTxState("error");
      const message = err instanceof Error ? err.message.slice(0, 220) : "Tx failed";
      setTxError(message);
      const isRejection = err instanceof Error && err.message.includes("user rejected");
      toast.error(
        isRejection ? "Cancelled" : "Agent failed",
        isRejection ? "You rejected the transaction" : message,
      );
    }
  }, [
    intent, account, initialized, encrypt, toast,
    paymentsContract, streamingContract, sealedContract, freelanceContract,
  ]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  const canRun = intent.kind !== "unknown" && intent.confidence >= 0.7;

  return (
    <main
      className="mx-auto max-w-3xl px-5 md:px-10 py-12 md:py-16 font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — CipherDEX Agent · Beta
        </div>
        <h1
          className="font-display font-bold tracking-tight leading-[1.02] mb-4"
          style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
        >
          Type.{" "}
          <em className="font-serif italic font-normal">Encrypt</em>. Send.
        </h1>
        <p
          className="max-w-2xl"
          style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}
        >
          Tell the agent what you want — in English. It picks the right contract,
          encrypts the sensitive fields, and shows you exactly what will run before you sign.
        </p>
        <div>
          <FaucetButton />
        </div>
      </header>

      {/* Input */}
      <section className="bg-white border border-dashed border-[var(--border-dash)] rounded p-5 mb-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
          <Wand2 size={12} className="text-[var(--text)]" /> Command
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. pay 0x... 500"
          rows={2}
          className="w-full bg-transparent text-base text-[var(--text)] placeholder-[var(--text-muted)]
                     outline-none resize-none font-mono"
        />
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-dash)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            {intent.kind === "unknown"
              ? "Tip — type one of the examples below."
              : `${(intent.confidence * 100).toFixed(0)}% confident · ${intent.rationale}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCopy(intent)}
              disabled={intent.kind === "unknown"}
              aria-label="Copy intent JSON"
              className="text-xs flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-30"
            >
              <Copy size={12} /> JSON
            </button>
            <button
              onClick={runIntent}
              disabled={!canRun || !account || txState === "signing" || txState === "confirming"}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium
                         bg-text from-[var(--text)] to-[var(--text)]
                         text-[var(--bg)] hover:shadow-lg hover:shadow-[var(--text)]/25
                         transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {txState === "signing" || txState === "confirming"
                ? <Loader2 size={14} className="animate-spin" />
                : <Zap size={14} />}
              {txState === "signing" ? "Signing…"
                : txState === "confirming" ? "Confirming…"
                : "Encrypt & run"}
            </button>
          </div>
        </div>
      </section>

      {/* Tx status */}
      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />

      {/* Resolved intent */}
      <AnimatePresence>
        {intent.kind !== "unknown" && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 mb-5 mt-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={14} className="text-[var(--text)]" />
              <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Resolved intent</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--text)]/15 text-[var(--text)] font-semibold">
                {intent.kind}
              </span>
            </div>
            <p className="text-sm text-[var(--text)] mb-3">{intent.summary}</p>

            {intent.contract && (
              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
                <Send size={11} />
                Routes to <code className="text-[var(--text)]">{intent.contract}</code>
              </div>
            )}

            <div className="bg-[var(--bg-alt)]/50 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Structured fields</div>
              <pre className="text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto">
{JSON.stringify(intent.fields, null, 2)}
              </pre>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--text)]">
              <Lock size={11} />
              Sensitive fields will be encrypted in your browser before submit.
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Example commands */}
      <section className="mt-6">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
          <Sparkles size={12} /> Example commands
        </div>
        <div className="space-y-2">
          {EXAMPLE_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              onClick={() => handleExampleClick(cmd)}
              className="w-full text-left rounded bg-[var(--bg-alt)]/40 hover:bg-[var(--bg-alt)]/80
                         border border-[var(--border-dash)] hover:border-[var(--text)]/40
                         px-3 py-2 text-xs font-mono text-[var(--text-secondary)] transition-colors"
            >
              {cmd}
            </button>
          ))}
        </div>
      </section>

      <footer className="mt-10 text-center text-[11px] text-[var(--text-muted)]">
        <p className="flex items-center justify-center gap-1.5">
          <AlertCircle size={11} className="text-[var(--text-muted)]" />
          Beta — pattern-matching parser. The parsed intent is shown before signing so you can verify.
        </p>
      </footer>
    </main>
  );
}
