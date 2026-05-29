"use client";

export const dynamic = "force-dynamic";

/**
 * Encrypted Reputation — /reputation
 *
 * View your own encrypted reputation score (sum of received ratings) via permit,
 * and your public trade count.
 *
 * Note on ratings: a rating can only be submitted between two parties who have
 * actually settled a trade, which an authorized feature contract records on-chain
 * via recordTrade() at settlement. Until that settlement path is wired end-to-end,
 * submitRating reverts for ordinary users by design, so this page intentionally
 * surfaces an honest "how reputation accrues" notice rather than an actionable
 * form that would always fail. The read/compute/unseal flow below is live.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Star, Loader2, RefreshCw, Lock, Eye,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";

export default function ReputationPage() {
  const { account } = useWallet();
  const { unseal, unsealing } = useUnseal();
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

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Reputation", type: "system", href: "/reputation", txHash });

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

  const handleRevealScore = useCallback(async () => {
    if (!encScoreHandle) return;
    const v = await unseal(BigInt(encScoreHandle), 5); // euint64
    if (v !== null) setUnsealedScore(v.toString());
  }, [encScoreHandle, unseal]);

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Encrypted Reputation" shipDate="soon" />
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
              Build a reputation score across every Zerith feature. Ratings stay encrypted on-chain — only you can unseal your own score.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
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
              <button onClick={handleRevealScore} disabled={unsealing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors disabled:opacity-50">
                {unsealing
                  ? <><Loader2 size={12} className="animate-spin" /> Decrypting…</>
                  : <><Eye size={12} /> Reveal to me</>}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6">
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5">
          <div className="flex items-start gap-3">
            <Star size={18} className="text-[var(--text)] shrink-0 mt-0.5" />
            <div className="space-y-2">
              <div className="text-sm font-semibold text-[var(--text)]">How reputation accrues</div>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Ratings can only be submitted between two parties who have <em className="font-serif italic">actually settled a trade</em> together.
                The Reputation contract verifies that settlement on-chain (via <span className="font-mono text-[12px]">recordTrade</span>) before
                accepting any rating — so reputation is earned through real protocol activity, never self-asserted.
              </p>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Complete a trade through an integrated feature (OrderBook, Auction, OTC, Escrow) and your trade count above will rise.
                Your encrypted score then accumulates from ratings your counterparties submit, and only you can unseal it.
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
                <Lock size={11} className="text-[var(--text)]" />
                Scores stay encrypted on-chain — even the protocol cannot read them without your permit.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
