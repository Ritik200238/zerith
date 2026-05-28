"use client";

export const dynamic = "force-dynamic";

/**
 * Encrypted Streaming Payments — /streaming
 *
 * Wave 4 hero feature. Sablier-style streams where the rate-per-second is
 * encrypted on-chain. Recipient claims any time; contract computes
 * encRate × elapsed on ciphertext, settles via the SettlementVault.
 *
 * Three flows:
 *   - Create stream (payer → recipient, encrypted rate, start/end time)
 *   - Claim (recipient pulls accrued amount)
 *   - Cancel (payer stops accrual)
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Lock, Clock, Send, X, Plus, Loader2, AlertCircle,
  CheckCircle2, RefreshCw, ArrowRight,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { parseAmount, isValidAddress, shortAddress, formatRemaining } from "@/lib/format";

interface StreamData {
  id: number;
  payer: string;
  recipient: string;
  token: string;
  startTime: number;
  endTime: number;
  lastClaimTime: number;
  status: number;
}

const STATUS_LABEL: Record<number, string> = { 0: "ACTIVE", 1: "CANCELLED", 2: "COMPLETED" };
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
  2: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]" },
};

export default function StreamingPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const streamingContract = useContract("EncryptedStreaming");
  const streamingRead = useReadContract("EncryptedStreaming");

  const deployed =
    CONTRACTS.EncryptedStreaming !== "0x0000000000000000000000000000000000000000";

  const [streams, setStreams] = useState<StreamData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // create form
  const [recipient, setRecipient] = useState("");
  const [rate, setRate] = useState("");
  const [duration, setDuration] = useState("3600"); // seconds
  const [delay, setDelay] = useState("0"); // start delay in seconds

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Streaming", type: "payment", href: "/streaming", txHash });

  const modalProps = useModalEscape(modalOpen, () => setModalOpen(false), "stream-modal-title");

  /* ---- fetch ---- */
  const fetchStreams = useCallback(async () => {
    if (!streamingRead) return;
    try {
      const count = Number(await streamingRead.getStreamCount());
      const out: StreamData[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const s = await streamingRead.getStream(i);
          out.push({
            id: i,
            payer: s[0],
            recipient: s[1],
            token: s[2],
            startTime: Number(s[3]),
            endTime: Number(s[4]),
            lastClaimTime: Number(s[5]),
            status: Number(s[6]),
          });
        } catch {
          /* skip */
        }
      }
      setStreams(out);
    } catch {
      /* noop */
    }
  }, [streamingRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchStreams();
  }, [fetchStreams, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  /* ---- create ---- */
  const handleCreate = useCallback(async () => {
    if (!streamingContract || !initialized || !recipient || !rate) return;
    if (!isValidAddress(recipient)) {
      toast.error("Invalid recipient", "Address must be a 0x-prefixed 40-character hex string");
      return;
    }
    const rateBn = parseAmount(rate);
    if (rateBn === null) {
      toast.error("Invalid rate", "Rate per second must be a positive number");
      return;
    }
    const dur = Number(duration);
    const startDelay = Number(delay);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "Stream must run at least 60 seconds");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint64(rateBn)]);
      if (!enc) throw new Error("Encryption failed");

      const startTime = Math.floor(Date.now() / 1000) + startDelay;
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

      setRecipient("");
      setRate("");
      setDuration("3600");
      setDelay("0");
      setModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const message = err instanceof Error ? err.message.slice(0, 200) : "Transaction failed";
      setTxError(message);
      const isRejection = err instanceof Error && err.message.includes("user rejected");
      toast.error(
        isRejection ? "Transaction cancelled" : "Stream creation failed",
        isRejection ? "You rejected the transaction" : message,
      );
    }
  }, [streamingContract, initialized, recipient, rate, duration, delay, encrypt, toast]);

  /* ---- claim ---- */
  const handleClaim = useCallback(
    async (stream: StreamData) => {
      if (!streamingContract) return;
      if (account?.toLowerCase() !== stream.recipient.toLowerCase()) {
        toast.error("Not your stream", "Only the recipient can claim");
        return;
      }
      setTxState("signing");
      setTxError(undefined);
      try {
        const tx = await streamingContract.claim(stream.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const message = err instanceof Error ? err.message.slice(0, 200) : "Claim failed";
        setTxError(message);
        toast.error("Claim failed", message);
      }
    },
    [streamingContract, account, toast],
  );

  /* ---- cancel ---- */
  const handleCancel = useCallback(
    async (stream: StreamData) => {
      if (!streamingContract) return;
      if (account?.toLowerCase() !== stream.payer.toLowerCase()) {
        toast.error("Not your stream", "Only the payer can cancel");
        return;
      }
      setTxState("signing");
      setTxError(undefined);
      try {
        const tx = await streamingContract.cancel(stream.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const message = err instanceof Error ? err.message.slice(0, 200) : "Cancel failed";
        setTxError(message);
        toast.error("Cancel failed", message);
      }
    },
    [streamingContract, account, toast],
  );

  /* ---- render ---- */
  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner
          feature="Encrypted Streaming Payments"
          shipDate="soon"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Payment streams
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Continuous payroll.{" "}<em className="font-serif italic font-normal">Rate encrypted</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Stream encrypted payments per second. Recipient sees their own flow — auditors see the duration, never the wage.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            aria-label="Refresh streams"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setModalOpen(true)}
            disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                       bg-text from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all"
          >
            <Plus size={14} /> Start stream
          </button>
        </div>
      </div>
        </header>

      {/* Tx status */}
      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />

      {/* Streams */}
      <section className="mt-6 grid gap-3">
        {streams.length === 0 ? (
          <EmptyState
            icon={Activity}
            eyebrow="No streams yet"
            title="Stream salaries by the second — without leaking the rate."
            body="Lock encrypted tokens to a recipient over a duration. The rate-per-second stays sealed. Recipients withdraw what's vested at any moment, and only they can see the running balance."
            primary={{ label: "Start stream", onClick: () => setModalOpen(true) }}
            secondary={{ label: "First time? Run the quickstart", href: "/quickstart" }}
          />
        ) : (
          streams.map((s) => {
            const isPayer = account?.toLowerCase() === s.payer.toLowerCase();
            const isRecipient = account?.toLowerCase() === s.recipient.toLowerCase();
            const style = STATUS_STYLE[s.status];
            return (
              <article key={s.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{s.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                    {isPayer && <span className="text-[10px] text-[var(--text)]">payer</span>}
                    {isRecipient && <span className="text-[10px] text-[var(--text)]">recipient</span>}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock size={12} />
                    {s.status === 0 ? formatRemaining(s.endTime) : "ended"}
                  </div>
                </div>

                <div className="mt-2 grid md:grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Payer</div>
                    <div className="font-mono text-[var(--text-secondary)]">{shortAddress(s.payer)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowRight size={12} className="text-[var(--text-muted)]" />
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Recipient</div>
                      <div className="font-mono text-[var(--text-secondary)]">{shortAddress(s.recipient)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Rate</div>
                    <div className="font-mono text-[var(--text-secondary)] flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" />
                      encrypted /s
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {isRecipient && s.status === 0 && (
                    <button
                      onClick={() => handleClaim(s)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Send size={12} /> Claim accrued
                    </button>
                  )}
                  {isPayer && s.status === 0 && (
                    <button
                      onClick={() => handleCancel(s)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <X size={12} /> Stop accrual
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* Create modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalOpen(false)}
            {...modalProps}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 id="stream-modal-title" className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Activity size={18} className="text-[var(--text)]" /> Start stream
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Recipient address</label>
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                  <Lock size={11} className="text-[var(--text)]" />
                  Rate per second (encrypted)
                </label>
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 0.01"
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                />
                <p className="text-[10px] text-[var(--text-muted)]">CDEX per second — your wallet encrypts before submit.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Duration (s)</label>
                  <input
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    type="number"
                    min={60}
                    className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Start delay (s)</label>
                  <input
                    value={delay}
                    onChange={(e) => setDelay(e.target.value)}
                    type="number"
                    min={0}
                    className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                  />
                </div>
              </div>

              {!initialized && (
                <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={!initialized || !recipient || !rate || txState === "signing" || txState === "confirming"}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                           bg-text from-[var(--text)] to-[var(--text)]
                           text-[var(--bg)] hover:shadow-lg hover:shadow-[var(--text)]/25
                           transition-all disabled:opacity-50"
              >
                {txState === "signing" || txState === "confirming"
                  ? <Loader2 size={14} className="animate-spin" />
                  : <CheckCircle2 size={14} />}
                {txState === "signing" ? "Signing…"
                  : txState === "confirming" ? "Confirming…"
                  : "Encrypt & create"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
