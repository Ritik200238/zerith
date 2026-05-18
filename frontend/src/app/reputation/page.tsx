"use client";

/**
 * Encrypted Reputation — /reputation
 *
 * Submit encrypted ratings (1-5) for counterparties you've traded with.
 * View your own encrypted score (sum of received ratings) via permit.
 *
 * Note: rating requires a previously recorded trade with the counterparty
 * (recorded by an authorized feature contract on settle). Without a trade,
 * the contract reverts.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star, Plus, X, Loader2, RefreshCw, Lock, Eye, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { isValidAddress } from "@/lib/format";

export default function ReputationPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const { unseal } = useUnseal();
  const toast = useToast();

  // getMyReputation depends on msg.sender — use signer-bound for that.
  // getTradeCount(user) takes explicit address — read provider is fine.
  const repContract = useContract("Reputation");
  const repRead = useContract("Reputation");
  const repReadProvider = useReadContract("Reputation");

  const deployed = CONTRACTS.Reputation !== "0x0000000000000000000000000000000000000000";

  const [tradeCount, setTradeCount] = useState<number>(0);
  const [encScoreHandle, setEncScoreHandle] = useState<string | null>(null);
  const [unsealedScore, setUnsealedScore] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // submit form
  const [counterparty, setCounterparty] = useState("");
  const [rating, setRating] = useState(5);
  const [tradeId, setTradeId] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Reputation", type: "system", href: "/reputation", txHash });

  const modalProps = useModalEscape(modalOpen, () => setModalOpen(false), "reputation-modal-title");

  const fetchData = useCallback(async () => {
    if (!account) return;
    try {
      if (repReadProvider) {
        const tc = Number(await repReadProvider.getTradeCount(account));
        setTradeCount(tc);
      }
      if (repRead) {
        try {
          const handle = await repRead.getMyReputation();
          setEncScoreHandle(handle.toString());
        } catch {
          setEncScoreHandle(null);
        }
      }
    } catch {
      /* noop */
    }
  }, [repRead, repReadProvider, account]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchData();
  }, [fetchData, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => {
    setEncScoreHandle(null);
    setUnsealedScore(null);
    setRefreshKey((k) => k + 1);
  }, []));

  const handleComputeReputation = useCallback(async () => {
    if (!repContract) return;
    setTxState("signing");
    try {
      const tx = await repContract.computeMyReputation();
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Compute failed", msg);
    }
  }, [repContract, toast]);

  const handleSubmitRating = useCallback(async () => {
    if (!repContract || !initialized) return;
    if (!isValidAddress(counterparty)) {
      toast.error("Invalid counterparty", "Must be 0x + 40 hex");
      return;
    }
    if (rating < 1 || rating > 5) {
      toast.error("Invalid rating", "Must be 1-5");
      return;
    }
    const tid = Number(tradeId);
    if (!Number.isFinite(tid) || tid < 0) {
      toast.error("Invalid trade ID", "Provide the trade ID this rating belongs to");
      return;
    }
    setTxState("signing");
    try {
      const { Encryptable } = await import("cofhejs/web");
      const enc = await encrypt([Encryptable.uint8(BigInt(rating))]);
      if (!enc) throw new Error("Encryption failed");
      const tx = await repContract.submitRating(counterparty, enc[0], BigInt(tid));
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setCounterparty("");
      setTradeId("");
      setModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Submit rating failed", msg);
    }
  }, [repContract, initialized, counterparty, rating, tradeId, encrypt, toast]);

  const handleRevealScore = useCallback(async () => {
    if (!encScoreHandle) return;
    const v = await unseal(BigInt(encScoreHandle), 5); // euint64
    if (v !== null) setUnsealedScore(v.toString());
  }, [encScoreHandle, unseal]);

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Encrypted Reputation" shipDate="Wave 4 deploy" />
      </main>
    );
  }

  const avgScore = unsealedScore && tradeCount > 0
    ? (Number(unsealedScore) / tradeCount).toFixed(2)
    : null;

  return (
    <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Reputation
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Encrypted ratings.{" "}<em className="font-serif italic font-normal">Composable credit</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Build a reputation score across every CipherDEX feature. Ratings encrypted — only counterparties you choose can read.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setModalOpen(true)} disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                       bg-text from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all">
            <Plus size={14} /> Submit rating
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="grid md:grid-cols-2 gap-4 mt-6">
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Your trade count
          </div>
          <div className="text-3xl font-mono text-[var(--text)]">{tradeCount}</div>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Public — visible from settlement events.</p>
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              Encrypted reputation score
            </div>
            <button onClick={handleComputeReputation} disabled={txState === "signing" || txState === "confirming"}
              className="text-[10px] text-[var(--text)] hover:text-[var(--text)] transition-colors disabled:opacity-40">
              recompute
            </button>
          </div>
          {!encScoreHandle ? (
            <p className="text-sm text-[var(--text-muted)]">
              <Lock size={14} className="inline text-[var(--text)] mr-1" />
              No score yet. Click recompute after receiving ratings.
            </p>
          ) : unsealedScore !== null ? (
            <>
              <div className="text-3xl font-mono text-[var(--text)]">{unsealedScore}</div>
              {avgScore && (
                <p className="text-[11px] text-[var(--text)] mt-1">
                  avg ~{avgScore} / 5 across {tradeCount} ratings
                </p>
              )}
              <button onClick={() => setUnsealedScore(null)}
                className="mt-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Hide
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-2xl font-mono text-[var(--text)]">•••</div>
              <button onClick={handleRevealScore}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
                <Eye size={12} /> Reveal to me
              </button>
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalOpen(false)} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4">

              <div className="flex items-center justify-between">
                <h3 id="reputation-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                  <Star size={18} className="text-[var(--text)]" /> Submit rating
                </h3>
                <button onClick={() => setModalOpen(false)} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Counterparty (the trader you&apos;re rating)</label>
                <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="0x..."
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Trade ID</label>
                <input value={tradeId} onChange={(e) => setTradeId(e.target.value)} type="number" min={0}
                  placeholder="ID of the settled trade between you two"
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                <p className="text-[10px] text-[var(--text-muted)]">Required — the contract verifies you actually traded with this party for this ID.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                  <Lock size={11} className="text-[var(--text)]" /> Rating (encrypted)
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`}
                      className={`p-2 rounded transition-colors ${
                        rating >= n ? "text-[var(--text-muted)] bg-[var(--bg-alt)]" : "text-[var(--text-muted)] hover:bg-bgCard"
                      }`}>
                      <Star size={16} fill={rating >= n ? "currentColor" : "none"} />
                    </button>
                  ))}
                  <span className="ml-2 text-sm font-mono text-[var(--text-secondary)]">{rating} / 5</span>
                </div>
              </div>
              {!initialized && (
                <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                </div>
              )}
              <button onClick={handleSubmitRating} disabled={!initialized || !counterparty || !tradeId || txState === "signing" || txState === "confirming"}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                           bg-text from-[var(--text)] to-[var(--text)]
                           text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                {txState === "signing" || txState === "confirming"
                  ? <Loader2 size={14} className="animate-spin" />
                  : <CheckCircle2 size={14} />}
                Encrypt & submit
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
