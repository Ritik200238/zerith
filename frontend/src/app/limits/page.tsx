"use client";

export const dynamic = "force-dynamic";

/**
 * Limit Order Engine — /limits
 *
 * Oracle-triggered limit orders. Trigger price encrypted; the oracle
 * calls checkPrice(currentPrice). When the encrypted condition matches,
 * the order is triggered and can be settled.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Plus, X, Loader2, RefreshCw, Lock,
  CheckCircle2, AlertCircle,
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
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { parseAmount } from "@/lib/format";

interface OrderData {
  id: number;
  owner: string;
  tokenBuy: string;
  tokenSell: string;
  amount: string;
  status: number; // 0 ACTIVE 1 TRIGGERED 2 SETTLED 3 CANCELLED
  direction: number; // 0 BUY_BELOW 1 SELL_ABOVE
}

const STATUS_LABEL: Record<number, string> = { 0: "ACTIVE", 1: "TRIGGERED", 2: "SETTLED", 3: "CANCELLED" };
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  3: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
};

export default function LimitsPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const limitsContract = useContract("LimitOrderEngine");
  const limitsRead = useReadContract("LimitOrderEngine");

  const deployed = CONTRACTS.LimitOrderEngine !== "0x0000000000000000000000000000000000000000";

  const [orders, setOrders] = useState<OrderData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // create form
  const [tokenBuy, setTokenBuy] = useState(CONTRACTS.ConfidentialToken);
  const [tokenSell, setTokenSell] = useState(CONTRACTS.ConfidentialToken);
  const [amount, setAmount] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [direction, setDirection] = useState<0 | 1>(0);

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Limit Orders", type: "trade", href: "/limits", txHash });

  const modalProps = useModalEscape(modalOpen, () => setModalOpen(false), "limits-modal-title");

  const fetchOrders = useCallback(async () => {
    if (!limitsRead) return;
    try {
      const count = Number(await limitsRead.nextOrderId());
      const out: OrderData[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const o = await limitsRead.limitOrders(i);
          out.push({
            id: i,
            owner: o.owner,
            tokenBuy: o.tokenBuy,
            tokenSell: o.tokenSell,
            amount: o.amount.toString(),
            status: Number(o.status),
            direction: Number(o.direction),
          });
        } catch {
          /* skip */
        }
      }
      setOrders(out.reverse());
    } catch {
      /* noop */
    }
  }, [limitsRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchOrders();
  }, [fetchOrders, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  const handleCreate = useCallback(async () => {
    if (!limitsContract || !initialized) return;
    if (tokenBuy === tokenSell) {
      toast.error("Invalid pair", "Tokens must differ");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Invalid amount", "Positive integer");
      return;
    }
    const priceBn = parseAmount(triggerPrice);
    if (priceBn === null) {
      toast.error("Invalid price", "Positive number");
      return;
    }

    setTxState("signing");
    try {
      const { Encryptable } = await import("cofhejs/web");
      const enc = await encrypt([Encryptable.uint128(priceBn)]);
      if (!enc) throw new Error("Encryption failed");
      const tx = await limitsContract.createLimitOrder(tokenBuy, tokenSell, BigInt(amt), enc[0], direction);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setAmount("");
      setTriggerPrice("");
      setModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Create failed", msg);
    }
  }, [limitsContract, initialized, tokenBuy, tokenSell, amount, triggerPrice, direction, encrypt, toast]);

  const handleCancel = useCallback(
    async (id: number) => {
      if (!limitsContract) return;
      setTxState("signing");
      try {
        const tx = await limitsContract.cancelLimitOrder(id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Cancel failed", msg);
      }
    },
    [limitsContract, toast],
  );

  const handleSettle = useCallback(
    async (id: number) => {
      if (!limitsContract) return;
      setTxState("signing");
      try {
        const tx = await limitsContract.settleTriggered(id);
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
    [limitsContract, toast],
  );

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Limit Order Engine" shipDate="Wave 4 deploy" />
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
          — Limit orders
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Hidden trigger price.{" "}<em className="font-serif italic font-normal">Zero front-run</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Place encrypted limit orders. MEV bots can&apos;t see your trigger price, can&apos;t sandwich, can&apos;t pick off your stop.
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
            <Plus size={14} /> New limit
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="mt-6 grid gap-3">
        {orders.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
            <Target size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">No limit orders</p>
          </div>
        ) : (
          orders.map((o) => {
            const style = STATUS_STYLE[o.status];
            const isMine = account && o.owner.toLowerCase() === account.toLowerCase();
            return (
              <article key={o.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{o.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {o.direction === 0 ? "BUY when ↓ encrypted" : "SELL when ↑ encrypted"}
                    </span>
                    {isMine && <span className="text-[10px] text-[var(--text)]">yours</span>}
                  </div>
                </div>
                <div className="mt-2 grid md:grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Amount</div>
                    <div className="font-mono text-[var(--text)]">{o.amount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Trigger price</div>
                    <div className="font-mono text-[var(--text-secondary)] flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> encrypted
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Status</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">{STATUS_LABEL[o.status]}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {o.status === 1 && (
                    <button onClick={() => handleSettle(o.id)}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <CheckCircle2 size={11} /> Settle triggered
                    </button>
                  )}
                  {o.status === 0 && isMine && (
                    <button onClick={() => handleCancel(o.id)}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                      <X size={11} /> Cancel
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalOpen(false)} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">

              <div className="flex items-center justify-between">
                <h3 id="limits-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                  <Target size={18} className="text-[var(--text)]" /> New limit order
                </h3>
                <button onClick={() => setModalOpen(false)} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setDirection(0)}
                  className={`px-3 py-2 rounded text-xs font-medium transition-colors ${
                    direction === 0 ? "bg-[var(--bg-alt)] text-[var(--text)]" : "bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-bgCard"
                  }`}>
                  BUY_BELOW
                </button>
                <button onClick={() => setDirection(1)}
                  className={`px-3 py-2 rounded text-xs font-medium transition-colors ${
                    direction === 1 ? "bg-[var(--bg-alt)] text-[var(--text-muted)]" : "bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-bgCard"
                  }`}>
                  SELL_ABOVE
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Token to buy</label>
                <input value={tokenBuy} onChange={(e) => setTokenBuy(e.target.value)} placeholder="0x..."
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Token to sell</label>
                <input value={tokenSell} onChange={(e) => setTokenSell(e.target.value)} placeholder="0x..."
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Amount (public)</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1}
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                  <Lock size={11} className="text-[var(--text)]" /> Trigger price (encrypted)
                </label>
                <input value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="100"
                  className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
              </div>
              {!initialized && (
                <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                </div>
              )}
              <button onClick={handleCreate} disabled={!initialized || !amount || !triggerPrice || txState === "signing" || txState === "confirming"}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                           bg-text from-[var(--text)] to-[var(--text)]
                           text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                {txState === "signing" || txState === "confirming"
                  ? <Loader2 size={14} className="animate-spin" />
                  : <CheckCircle2 size={14} />}
                Encrypt & create
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
