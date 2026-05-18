"use client";

/**
 * Encrypted Raffle — /raffle
 *
 * F6 hero feature. Public ticket purchase, encrypted random winner via
 * FHE.randomEuint64(). Winner index is encrypted on-chain until a TN
 * signature reveals it.
 *
 * Flow: Create → Buy ticket(s) → Wait for deadline → Draw → Reveal → Claim.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy, Plus, Loader2, RefreshCw, Clock, Ticket, X, AlertCircle,
  Lock, CheckCircle2, Sparkles, Gift,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { formatAmount, formatRemaining, parseAmount, shortAddress } from "@/lib/format";

interface RaffleData {
  id: number;
  creator: string;
  token: string;
  ticketPrice: string;
  maxTickets: number;
  ticketCount: number;
  deadline: number;
  winner: string;
  winnerIndex: number;
  status: number; // 0=OPEN 1=CLOSED 2=REVEAL_REQUESTED 3=REVEALED 4=CLAIMED 5=CANCELLED
}

const STATUS_LABEL: Record<number, string> = {
  0: "OPEN", 1: "CLOSED", 2: "AWAITING REVEAL", 3: "WINNER REVEALED", 4: "CLAIMED", 5: "CANCELLED",
};
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  3: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  4: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]" },
  5: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
};

export default function RafflePage() {
  const { account } = useWallet();
  const toast = useToast();
  const raffleContract = useContract("EncryptedRaffle");
  const raffleRead = useReadContract("EncryptedRaffle");
  const tokenContract = useContract("ConfidentialToken");
  const { decrypt: decryptForTx } = useDecryptForTx();

  const deployed =
    CONTRACTS.EncryptedRaffle !== "0x0000000000000000000000000000000000000000";

  const [raffles, setRaffles] = useState<RaffleData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // create form
  const [ticketPrice, setTicketPrice] = useState("10");
  const [maxTickets, setMaxTickets] = useState("100");
  const [duration, setDuration] = useState("3600");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Encrypted Raffle", type: "system", href: "/raffle", txHash });

  const modalProps = useModalEscape(modalOpen, () => setModalOpen(false), "raffle-modal-title");

  /* ---------------------------------------------------------------- */
  /* fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchRaffles = useCallback(async () => {
    if (!raffleRead) return;
    try {
      const count = Number(await raffleRead.getRaffleCount());
      const out: RaffleData[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const r = await raffleRead.raffles(i);
          out.push({
            id: i,
            creator: r.creator,
            token: r.token,
            ticketPrice: r.ticketPrice.toString(),
            maxTickets: Number(r.maxTickets),
            ticketCount: Number(r.ticketCount),
            deadline: Number(r.deadline),
            winner: r.winner,
            winnerIndex: Number(r.winnerIndex),
            status: Number(r.status),
          });
        } catch {
          /* skip */
        }
      }
      setRaffles(out.reverse());
    } catch {
      /* noop */
    }
  }, [raffleRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchRaffles();
  }, [fetchRaffles, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  /* ---------------------------------------------------------------- */
  /* create                                                            */
  /* ---------------------------------------------------------------- */

  const handleCreate = useCallback(async () => {
    if (!raffleContract) return;
    const price = parseAmount(ticketPrice);
    if (price === null) {
      toast.error("Invalid ticket price", "Must be a positive number");
      return;
    }
    const max = Number(maxTickets);
    const dur = Number(duration);
    if (!Number.isFinite(max) || max < 2 || max > 1000) {
      toast.error("Invalid max tickets", "Must be 2–1000");
      return;
    }
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "At least 60 seconds");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    try {
      const tx = await raffleContract.createRaffle(
        CONTRACTS.ConfidentialToken,
        price,
        BigInt(max),
        BigInt(dur),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setTicketPrice("10");
      setMaxTickets("100");
      setDuration("3600");
      setModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      const isRej = err instanceof Error && err.message.includes("user rejected");
      toast.error(isRej ? "Cancelled" : "Create failed", isRej ? "" : msg);
    }
  }, [raffleContract, ticketPrice, maxTickets, duration, toast]);

  /* ---------------------------------------------------------------- */
  /* buy ticket                                                        */
  /* ---------------------------------------------------------------- */

  const handleBuy = useCallback(
    async (r: RaffleData) => {
      if (!raffleContract || !tokenContract) return;
      setTxState("signing");
      setTxError(undefined);
      try {
        // Approve ticket price (the token must allow the raffle contract to pull funds)
        const allowanceTx = await tokenContract.approve(
          CONTRACTS.EncryptedRaffle,
          r.ticketPrice,
        );
        await allowanceTx.wait();

        const tx = await raffleContract.buyTicket(r.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Buy failed", msg);
      }
    },
    [raffleContract, tokenContract, toast],
  );

  /* ---------------------------------------------------------------- */
  /* draw → reveal                                                     */
  /* ---------------------------------------------------------------- */

  const handleDraw = useCallback(
    async (r: RaffleData) => {
      if (!raffleContract) return;
      setTxState("signing");
      setTxError(undefined);
      try {
        const tx = await raffleContract.drawWinner(r.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Draw failed", msg);
      }
    },
    [raffleContract, toast],
  );

  const handleReveal = useCallback(
    async (r: RaffleData) => {
      if (!raffleContract || !raffleRead) return;
      setTxState("decrypting");
      setTxError(undefined);
      try {
        const handle = await raffleRead.getEncWinnerIndex(r.id);
        const handleBn = BigInt(handle);
        const result = await decryptForTx(handleBn);
        if (!result) throw new Error("Reveal failed — TN signature not available");

        setTxState("signing");
        const tx = await raffleContract.revealWinner(
          r.id,
          BigInt(result.decryptedValue),
          result.signature,
        );
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Reveal failed", msg);
      }
    },
    [raffleContract, raffleRead, decryptForTx, toast],
  );

  const handleClaim = useCallback(
    async (r: RaffleData) => {
      if (!raffleContract) return;
      if (account?.toLowerCase() !== r.winner.toLowerCase()) {
        toast.error("Not your prize", "Only the winning address can claim");
        return;
      }
      setTxState("signing");
      try {
        const tx = await raffleContract.claimPrize(r.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Claim failed", msg);
      }
    },
    [raffleContract, account, toast],
  );

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Encrypted Raffle" shipDate="Wave 4 deploy" />
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
          — Encrypted raffle
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Sealed entries.{" "}<em className="font-serif italic font-normal">Verifiable winner</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Ticket counts encrypted on commit. Winner selection verifiable — but pre-draw counts stay sealed to prevent collusion.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            aria-label="Refresh raffles"
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
            <Plus size={14} /> New raffle
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />

      <section className="mt-6 grid gap-3">
        {raffles.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
            <Trophy size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">No raffles yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Click <b>New raffle</b> to create one.</p>
          </div>
        ) : (
          raffles.map((r) => {
            const style = STATUS_STYLE[r.status];
            const expired = r.deadline < Math.floor(Date.now() / 1000);
            const prize = (BigInt(r.ticketPrice) * BigInt(r.ticketCount)).toString();
            return (
              <article key={r.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{r.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">by {shortAddress(r.creator)}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock size={12} />
                    {r.status === 0 ? formatRemaining(r.deadline) : "ended"}
                  </div>
                </div>

                <div className="mt-3 grid md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Ticket price</div>
                    <div className="font-mono text-[var(--text)]">{formatAmount(r.ticketPrice)} CDEX</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Tickets</div>
                    <div className="font-mono text-[var(--text)]">{r.ticketCount} / {r.maxTickets}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Prize pool</div>
                    <div className="font-mono text-[var(--text)]">{formatAmount(prize)} CDEX</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Winner</div>
                    <div className="font-mono text-[var(--text-secondary)] flex items-center gap-1">
                      {r.winner === ethers.ZeroAddress ? (
                        <><Lock size={11} className="text-[var(--text)]" /> encrypted</>
                      ) : (
                        <><Sparkles size={11} className="text-warning" /> {shortAddress(r.winner)}</>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {r.status === 0 && !expired && r.ticketCount < r.maxTickets && account && (
                    <button
                      onClick={() => handleBuy(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Ticket size={12} /> Buy ticket
                    </button>
                  )}
                  {r.status === 0 && expired && r.ticketCount > 0 && (
                    <button
                      onClick={() => handleDraw(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Sparkles size={12} /> Draw winner
                    </button>
                  )}
                  {r.status === 2 && (
                    <button
                      onClick={() => handleReveal(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Lock size={12} /> Reveal index
                    </button>
                  )}
                  {r.status === 3 && account?.toLowerCase() === r.winner.toLowerCase() && (
                    <button
                      onClick={() => handleClaim(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Gift size={12} /> Claim prize
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
                <h3 id="raffle-modal-title" className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Trophy size={18} className="text-[var(--text)]" /> Create raffle
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
                <label className="text-xs text-[var(--text-muted)] font-medium">Ticket price (CDEX)</label>
                <input
                  value={ticketPrice}
                  onChange={(e) => setTicketPrice(e.target.value)}
                  placeholder="10"
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Max tickets</label>
                  <input
                    value={maxTickets}
                    onChange={(e) => setMaxTickets(e.target.value)}
                    type="number"
                    min={2}
                    max={1000}
                    className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                  />
                </div>
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
              </div>

              <div className="rounded bg-[var(--text)]/10 border border-[var(--text)]/20 p-3 flex items-start gap-2 text-xs">
                <AlertCircle size={14} className="text-[var(--text)] shrink-0 mt-0.5" />
                <span className="text-[var(--text)]">
                  Winner index is generated via <code>FHE.randomEuint64()</code> — neither you
                  nor any participant can predict or influence the result.
                </span>
              </div>

              <button
                onClick={handleCreate}
                disabled={!ticketPrice || !maxTickets || !duration || txState === "signing" || txState === "confirming"}
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
                  : "Create raffle"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
