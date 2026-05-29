"use client";

export const dynamic = "force-dynamic";

/**
 * Batch (Clearing-Price) Auction — /batch
 *
 * Admin creates a round. Users submit encrypted buy/sell orders. After
 * deadline, admin closes & computes clearing price on ciphertext using a
 * provided price ladder. Settle distributes tokens.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, Plus, X, Loader2, RefreshCw, Lock, Clock, Eye,
  CheckCircle2, AlertCircle, ShoppingCart, ShoppingBag, Hammer,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { TxFlowDrawer } from "@/components/shared/TxFlowDrawer";
import { useTxFlow } from "@/hooks/useTxFlow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";
import { parseAmount, formatAmount, formatRemaining } from "@/lib/format";

interface RoundData {
  id: number;
  tokenA: string;
  tokenB: string;
  startTime: number;
  endTime: number;
  status: number;
  clearingPrice: string;
  buyCount: number;
  sellCount: number;
}

const STATUS_LABEL: Record<number, string> = { 0: "COLLECTING", 1: "CLOSED", 2: "CLEARING", 3: "SETTLED" };
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  3: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]" },
};

type ModalView = "none" | "create" | "buy" | "sell";

export default function BatchPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const batchContract = useContract("BatchAuction");
  const batchRead = useReadContract("BatchAuction");
  const { decrypt: decryptForTx } = useDecryptForTx();

  const deployed = CONTRACTS.BatchAuction !== "0x0000000000000000000000000000000000000000";

  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [admin, setAdmin] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedRound, setSelectedRound] = useState<RoundData | null>(null);

  const [tokenA, setTokenA] = useState(CONTRACTS.ConfidentialToken);
  const [tokenB, setTokenB] = useState(CONTRACTS.ConfidentialToken);
  const [duration, setDuration] = useState("3600");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [priceLadder, setPriceLadder] = useState("100,200,500");

  const [txState, setTxState] = useState<TxState>("idle");
  const orderFlow = useTxFlow();
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Batch Auction", type: "auction", href: "/batch", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "batch-modal-title");

  const fetchRounds = useCallback(async () => {
    if (!batchRead) return;
    try {
      const adminAddr = await batchRead.admin();
      setAdmin(adminAddr);
      const count = Number(await batchRead.getRoundCount());
      const indices = Array.from({ length: count }, (_, i) => i);
      const raws = await Promise.all(
        indices.map((i) => batchRead.getRound(i).catch(() => null)),
      );
      const out: RoundData[] = [];
      raws.forEach((r, i) => {
        if (!r) return;
        out.push({
          id: i,
          tokenA: r[0],
          tokenB: r[1],
          startTime: Number(r[2]),
          endTime: Number(r[3]),
          status: Number(r[4]),
          clearingPrice: r[5].toString(),
          buyCount: Number(r[6]),
          sellCount: Number(r[7]),
        });
      });
      setRounds(out.reverse());
    } catch {
      /* noop */
    }
  }, [batchRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchRounds();
  }, [fetchRounds, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  const isAdmin = !!(admin && account && admin.toLowerCase() === account.toLowerCase());

  const handleCreate = useCallback(async () => {
    if (!batchContract) return;
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "≥ 60 seconds");
      return;
    }
    if (tokenA === tokenB) {
      toast.error("Invalid pair", "tokenA and tokenB must differ");
      return;
    }
    setTxState("signing");
    try {
      const tx = await batchContract.createRound(tokenA, tokenB, BigInt(dur));
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Create failed", msg);
    }
  }, [batchContract, duration, tokenA, tokenB, toast]);

  const handleSubmitOrder = useCallback(
    async (side: "buy" | "sell") => {
      if (!batchContract || !initialized || !selectedRound) return;
      const priceBn = parseAmount(orderPrice);
      const amount = Number(orderAmount);
      if (priceBn === null) {
        toast.error("Invalid price", "Positive number");
        return;
      }
      const MAX_ORDER_AMOUNT = 1_000_000_000;
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
        toast.error("Invalid amount", "Positive integer");
        return;
      }
      if (amount > MAX_ORDER_AMOUNT) {
        toast.error("Amount too large", `Max ${MAX_ORDER_AMOUNT.toLocaleString()} per order`);
        return;
      }
      setTxState("signing");
      orderFlow.begin();
      try {
        const { Encryptable } = await import("@cofhe/sdk");
        const enc = await encrypt([Encryptable.uint128(priceBn)]);
        if (!enc) throw new Error("Encryption failed");
        orderFlow.submitted();
        const fn = side === "buy" ? "submitBuyOrder" : "submitSellOrder";
        const tx = await batchContract[fn](selectedRound.id, enc[0], BigInt(amount));
        setTxState("confirming");
        setTxHash(tx.hash);
        orderFlow.confirmed(tx.hash);
        await tx.wait();
        setTxState("success");
        orderFlow.sealed();
        setOrderPrice("");
        setOrderAmount("");
        setModalView("none");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        orderFlow.failed(err);
        toast.error(`${side} order failed`, msg);
      }
    },
    [batchContract, initialized, selectedRound, orderPrice, orderAmount, encrypt, toast, orderFlow],
  );

  const handleCloseAndCompute = useCallback(
    async (round: RoundData) => {
      if (!batchContract) return;
      let ladder: bigint[];
      try {
        ladder = priceLadder
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => {
            if (!/^\d+$/.test(s)) throw new Error(`bad token: ${s}`);
            const n = BigInt(s);
            if (n <= BigInt(0)) throw new Error(`non-positive: ${s}`);
            return n;
          });
      } catch {
        toast.error("Invalid ladder", "comma-separated positive integers only");
        return;
      }
      if (ladder.length === 0) {
        toast.error("Invalid ladder", "comma-separated positive integers only");
        return;
      }
      setTxState("signing");
      try {
        const tx = await batchContract.closeAndCompute(round.id, ladder);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Close failed", msg);
      }
    },
    [batchContract, priceLadder, toast],
  );

  /** Reveal clearing price via TN signature. CLEARING status only. */
  const handleReveal = useCallback(
    async (round: RoundData) => {
      if (!batchContract || !batchRead) return;
      setTxState("decrypting");
      try {
        const handleBn = BigInt(await batchRead.getEncClearingPrice(round.id));
        const result = await decryptForTx(handleBn);
        if (!result) throw new Error("Reveal failed — TN signature not available");

        setTxState("signing");
        const tx = await batchContract.revealClearingPrice(
          round.id,
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
    [batchContract, batchRead, decryptForTx, toast],
  );

  const handleSettle = useCallback(
    async (round: RoundData) => {
      if (!batchContract) return;
      setTxState("signing");
      try {
        const tx = await batchContract.settleRound(round.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Settle failed", msg);
      }
    },
    [batchContract, toast],
  );

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Batch Auction" shipDate="soon" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Batch / clearing auctions
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              One price.{" "}<em className="font-serif italic font-normal">Settles everyone</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              All bidders submit encrypted bids. The contract finds the uniform clearing price and matches all qualifying bids.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
          </button>
          {isAdmin && (
            <button onClick={() => setModalView("create")}
              className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                         bg-text from-[var(--text)] to-[var(--text)]
                         text-[var(--bg)] hover:shadow-lg transition-all">
              <Plus size={14} /> New round
            </button>
          )}
        </div>
      </div>
        </header>

      {!isAdmin && admin && (
        <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs mb-4">
          <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
          <span className="text-[var(--text-muted)]">
            Only admin (<code className="font-mono">{admin.slice(0,6)}…{admin.slice(-4)}</code>) creates rounds. You can submit orders to existing rounds.
          </span>
        </div>
      )}

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="mt-6 grid gap-3">
        {rounds.length === 0 ? (
          <EmptyState
            icon={Layers}
            eyebrow="No batch rounds yet"
            title="Settle every order at one fair clearing price."
            body="During the round, bidders submit encrypted price + quantity. At close, the contract finds the single clearing price that maximizes filled volume. No order arrival advantage. No MEV sandwich. Same price for everyone."
            primary={{ label: "Create round", onClick: handleCreate }}
            secondary={{ label: "First time? Run the quickstart", href: "/quickstart" }}
          />
        ) : (
          rounds.map((r) => {
            const style = STATUS_STYLE[r.status];
            const expired = r.endTime < Math.floor(Date.now() / 1000);
            return (
              <article key={r.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{r.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock size={12} />
                    {r.status === 0 ? formatRemaining(r.endTime) : "ended"}
                  </span>
                </div>
                <div className="mt-3 grid md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Buy / sell orders</div>
                    <div className="font-mono text-[var(--text)]">{r.buyCount} / {r.sellCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Clearing price</div>
                    <div className="font-mono text-[var(--text-secondary)] flex items-center gap-1">
                      {r.status >= 2 && r.clearingPrice !== "0"
                        ? formatAmount(r.clearingPrice)
                        : <><Lock size={11} className="text-[var(--text)]" /> encrypted</>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Status</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">{STATUS_LABEL[r.status]}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {r.status === 0 && !expired && account && (
                    <>
                      <button onClick={() => { setSelectedRound(r); setModalView("buy"); }}
                        className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                        <ShoppingCart size={11} /> Submit buy
                      </button>
                      <button onClick={() => { setSelectedRound(r); setModalView("sell"); }}
                        className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                        <ShoppingBag size={11} /> Submit sell
                      </button>
                    </>
                  )}
                  {r.status === 0 && expired && isAdmin && (
                    <div className="flex items-center gap-2 flex-wrap w-full">
                      <input value={priceLadder} onChange={(e) => setPriceLadder(e.target.value)}
                        placeholder="100,200,500"
                        className="flex-1 bg-[var(--bg-alt)] rounded px-2.5 py-1.5 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                      <button onClick={() => handleCloseAndCompute(r)}
                        className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                        <Hammer size={11} /> Close & compute
                      </button>
                    </div>
                  )}
                  {r.status === 2 && (
                    <button onClick={() => handleReveal(r)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Eye size={11} /> Reveal clearing price (TN)
                    </button>
                  )}
                  {r.status === 2 && r.clearingPrice !== "0" && isAdmin && (
                    <button onClick={() => handleSettle(r)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <CheckCircle2 size={11} /> Settle round
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4">

              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="batch-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Layers size={18} className="text-[var(--text)]" /> New round
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Token A (sell side)</label>
                    <input value={tokenA} onChange={(e) => setTokenA(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Token B (buy side)</label>
                    <input value={tokenB} onChange={(e) => setTokenB(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Duration (seconds)</label>
                    <input value={duration} onChange={(e) => setDuration(e.target.value)} type="number" min={60}
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleCreate} disabled={!duration || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Create round
                  </button>
                </>
              )}

              {(modalView === "buy" || modalView === "sell") && selectedRound && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      {modalView === "buy"
                        ? <><ShoppingCart size={18} className="text-[var(--text)]" /> Submit buy order</>
                        : <><ShoppingBag size={18} className="text-[var(--text-muted)]" /> Submit sell order</>}
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" />
                      {modalView === "buy" ? "Max price you'll pay" : "Min price you'll accept"} (encrypted)
                    </label>
                    <input value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} placeholder="100"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Amount (public)</label>
                    <input value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} type="number" min={1} max={1000000000} step={1}
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  {!initialized && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button onClick={() => handleSubmitOrder(modalView)} disabled={!initialized || !orderPrice || !orderAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Submit
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <TxFlowDrawer
        open={orderFlow.step !== "idle"}
        step={orderFlow.step}
        subjectNoun="order"
        title={orderFlow.step === "sealed" ? "Order sealed" : "Sealing your order"}
        txHash={orderFlow.txHash}
        chainId={FHENIX_TESTNET.chainId}
        errorMessage={orderFlow.errorMessage}
        onClose={orderFlow.close}
      />
    </main>
  );
}
