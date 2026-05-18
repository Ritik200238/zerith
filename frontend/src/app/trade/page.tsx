"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  Lock,
  X,
  ChevronDown,
  Loader2,
  Plus,
  Eye,
  Trash2,
  ShoppingCart,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useContract, useReadContract } from "@/hooks/useContract";
import { EncryptionProgress } from "@/components/shared/EncryptionProgress";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { CONTRACTS } from "@/lib/constants";
import { parseAmount } from "@/lib/format";
import { useTxFeedback } from "@/hooks/useTxFeedback";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface OrderData {
  id: number;
  maker: string;
  tokenSell: string;
  tokenBuy: string;
  amountSell: string;
  side: number; // 0 = BUY, 1 = SELL
  status: number; // 0 = ACTIVE, 1 = FILLED, 2 = CANCELLED
  createdAt: number;
  unsealedPrice: string | null;
}

type ModalView = "none" | "fill";

/* ------------------------------------------------------------------ */
/* Token helpers */
/* ------------------------------------------------------------------ */

const TOKEN_OPTIONS = [
  { label: "CDEX", address: CONTRACTS.ConfidentialToken, symbol: "CDEX" },
];

function tokenSymbol(addr: string): string {
  const found = TOKEN_OPTIONS.find(
    (t) => t.address.toLowerCase() === addr.toLowerCase(),
  );
  return found ? found.symbol : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Token dropdown */
/* ------------------------------------------------------------------ */

function TokenDropdown({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-[var(--text-muted)] font-medium">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-2 rounded px-3 py-2.5
                     bg-[var(--bg)] border border-[var(--border-dash)] text-sm text-[var(--text)]
                     hover:border-[var(--border-dash)] transition-colors"
        >
          <span>{value ? tokenSymbol(value) : "Select token"}</span>
          <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute z-50 mt-1 w-full rounded border border-[var(--border-dash)] bg-[var(--bg-card)]  overflow-hidden"
            >
              {TOKEN_OPTIONS.map((t) => (
                <button
                  key={t.address}
                  onClick={() => {
                    onChange(t.address);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${
                    value === t.address
                      ? "bg-[var(--bg-alt)] text-[var(--text)]"
                      : "text-[var(--text)] hover:bg-[var(--bg-alt)]"
                  }`}
                >
                  {t.symbol}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================================================================== */
/* TradePage */
/* ================================================================== */

export default function TradePage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const orderBookContract = useContract("OrderBook");
  const orderBookRead = useReadContract("OrderBook");

  /* ---- Private ref for ciphertext handles (not exposed in React state/DevTools) ---- */
  const encHandlesRef = useRef<Map<number, bigint>>(new Map());

  /* ---- State ---- */
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create order form
  const [sellToken, setSellToken] = useState<string>(CONTRACTS.ConfidentialToken);
  const [buyToken, setBuyToken] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [side, setSide] = useState<0 | 1>(1);

  // Fill order modal
  const [modalView, setModalView] = useState<ModalView>("none");
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));
  const [selectedOrder, setSelectedOrder] = useState<OrderData | null>(null);
  const [takerPrice, setTakerPrice] = useState("");

  // Transaction
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Trade", type: "trade", href: "/trade", txHash });
  const [txError, setTxError] = useState<string | undefined>();

  const contractDeployed =
    CONTRACTS.OrderBook !== "0x0000000000000000000000000000000000000000";

  /* ---------------------------------------------------------------- */
  /* Fetch active orders from chain */
  /* ---------------------------------------------------------------- */

  const fetchOrders = useCallback(async () => {
    if (!orderBookRead) return;
    setLoading(true);
    try {
      const count = await orderBookRead.getActiveOrderCount();
      const num = Number(count);
      const fetched: OrderData[] = [];

      for (let i = 0; i < num; i++) {
        const orderId = await orderBookRead.getActiveOrderId(i);
        const o = await orderBookRead.getOrder(orderId);
        const id = Number(orderId);
        // Store ciphertext handle in ref (not React state) to avoid DevTools exposure
        encHandlesRef.current.set(id, BigInt(o[4]));
        fetched.push({
          id,
          maker: o[0],
          tokenSell: o[1],
          tokenBuy: o[2],
          amountSell: o[3].toString(),
          side: Number(o[5]),
          status: Number(o[6]),
          createdAt: Number(o[7]),
          unsealedPrice: null,
        });
      }

      setOrders(fetched);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [orderBookRead]);

  const blockTick = useBlockPoll();
  const toast = useToast();

  // Shared tx-error helper — replaces silent errors with toast feedback
  const handleTxErrorFn = (err: unknown) => {
    const isRejection = err instanceof Error && err.message.includes("user rejected");
    const message = isRejection
      ? "You rejected the transaction in your wallet"
      : err instanceof Error ? err.message.slice(0, 200) : "Transaction failed";
    setTxError(message);
    toast.error(isRejection ? "Transaction cancelled" : "Transaction failed", message);
  };
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, refreshKey, blockTick]);

  // Audit fix E1: clear cross-account state on wallet switch
  useAccountChangeReset(useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /* Unseal own order price */
  /* ---------------------------------------------------------------- */

  const unsealPrice = useCallback(
    async (order: OrderData) => {
      if (!account || order.maker.toLowerCase() !== account.toLowerCase()) return;
      const ctHash = encHandlesRef.current.get(order.id);
      if (ctHash === undefined) return;
      // FheTypes.Uint128 = 5
      const value = await unseal(ctHash, 5);
      if (value !== null) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, unsealedPrice: value.toString() } : o,
          ),
        );
      }
    },
    [account, unseal],
  );

  /* ---------------------------------------------------------------- */
  /* Create order */
  /* ---------------------------------------------------------------- */

  const handleCreateOrder = useCallback(async () => {
    if (!orderBookContract || !initialized || !amount || !price || !sellToken || !buyToken) return;

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      // Audit fix G1: validate decimal-friendly amount/price
      const amountBn = parseAmount(amount);
      const priceBn = parseAmount(price);
      if (amountBn === null || priceBn === null) {
        toast.error("Invalid input", "Amount and price must be positive numbers");
        setTxState("idle");
        return;
      }
      const { Encryptable } = await import("@cofhe/sdk");
      const encrypted = await encrypt([Encryptable.uint128(priceBn)]);
      if (!encrypted) throw new Error("Encryption failed");

      const tx = await orderBookContract.createOrder(
        sellToken,
        buyToken,
        amountBn,
        encrypted[0],
        side,
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");

      setAmount("");
      setPrice("");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      handleTxErrorFn(err);
    }
  }, [orderBookContract, initialized, amount, price, sellToken, buyToken, side, encrypt]);

  /* ---------------------------------------------------------------- */
  /* Fill order */
  /* ---------------------------------------------------------------- */

  const handleFillOrder = useCallback(async () => {
    if (!orderBookContract || !initialized || !selectedOrder || !takerPrice) return;

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const takerPriceBn = parseAmount(takerPrice);
      if (takerPriceBn === null) {
        toast.error("Invalid price", "Price must be a positive number");
        setTxState("idle");
        return;
      }
      const { Encryptable } = await import("@cofhe/sdk");
      const encrypted = await encrypt([Encryptable.uint128(takerPriceBn)]);
      if (!encrypted) throw new Error("Encryption failed");

      const tx = await orderBookContract.fillOrder(selectedOrder.id, encrypted[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");

      setModalView("none");
      setSelectedOrder(null);
      setTakerPrice("");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      handleTxErrorFn(err);
    }
  }, [orderBookContract, initialized, selectedOrder, takerPrice, encrypt]);

  /* ---------------------------------------------------------------- */
  /* Cancel order */
  /* ---------------------------------------------------------------- */

  const handleCancelOrder = useCallback(
    async (orderId: number) => {
      if (!orderBookContract) return;
      setTxState("signing");
      setTxError(undefined);
      setTxHash(undefined);

      try {
        const tx = await orderBookContract.cancelOrder(orderId);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        setTxError(
          err instanceof Error
            ? err.message.includes("user rejected")
              ? "Transaction rejected"
              : err.message.slice(0, 120)
            : "Transaction failed",
        );
      }
    },
    [orderBookContract],
  );

  /* ---------------------------------------------------------------- */
  /* Helpers */
  /* ---------------------------------------------------------------- */

  const isOwner = (order: OrderData) =>
    account !== null && order.maker.toLowerCase() === account.toLowerCase();

  const myOrders = orders.filter((o) => isOwner(o));

  /* ================================================================ */
  /* Render */
  /* ================================================================ */

  return (
    <div className="space-y-10 max-w-[1180px] mx-auto px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* ---- Header ---- */}
      <div className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — P2P trading
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Order book.{" "}<em className="font-serif italic font-normal">Encrypted balances</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Trade peer-to-peer with encrypted balances. The order book stores intent — matchers fill without ever seeing wallet sizes.
            </p>
          </div>
        <FaucetButton />
      </div></div>
      

      {/* ---- Wallet not connected ---- */}
      {!account && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-10 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded bg-text flex items-center justify-center">
            <Lock size={24} className="text-[var(--text)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text)]">
            Connect your wallet to trade
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            All order prices are encrypted with FHE. Connect MetaMask to create
            orders, fill orders, and view your positions.
          </p>
        </div>
      )}

      {/* ---- Contract not deployed ---- */}
      {account && !contractDeployed && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 border-[var(--border-dash)] flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--text-muted)]">
              OrderBook contract not deployed yet
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Deploy the contracts first, then update the address in
              constants.ts to enable live trading.
            </p>
          </div>
        </div>
      )}

      {/* Transaction + encryption status */}
      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />
      <EncryptionProgress stage={stage} visible={encrypting} />

      {/* ---- Main layout ---- */}
      {account && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ================= ORDER BOOK (left 2/3) ================= */}
          <div className="lg:col-span-2 bg-white border border-dashed border-[var(--border-dash)] rounded overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-dash)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
                Order Book
              </h2>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {loading && orders.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={22} className="text-[var(--text)] animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <div className="py-20 text-center space-y-2">
                <ArrowLeftRight size={32} className="mx-auto text-[var(--text-muted)]" />
                <p className="text-sm text-[var(--text-muted)]">No active orders</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Create the first encrypted order to get started
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-dash)]">
                      <th className="text-left px-5 py-3 font-medium">ID</th>
                      <th className="text-left px-5 py-3 font-medium">Pair</th>
                      <th className="text-left px-5 py-3 font-medium">Side</th>
                      <th className="text-right px-5 py-3 font-medium">Amount</th>
                      <th className="text-right px-5 py-3 font-medium">Price</th>
                      <th className="text-center px-5 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const mine = isOwner(order);
                      const isBuy = order.side === 0;

                      return (
                        <motion.tr
                          key={order.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="border-b border-[var(--border-dash)] hover:bg-bgCard transition-colors"
                        >
                          <td className="px-5 py-3.5 font-mono text-[var(--text-muted)] text-xs">
                            #{order.id}
                          </td>
                          <td className="px-5 py-3.5 text-[var(--text)] font-medium">
                            {tokenSymbol(order.tokenSell)}/{tokenSymbol(order.tokenBuy)}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold tracking-wide ${
                                isBuy
                                  ? "bg-[var(--bg-alt)] text-[var(--text)] border border-[var(--border-dash)]"
                                  : "bg-[var(--bg-alt)] text-[var(--text-muted)] border border-[var(--border-dash)]"
                              }`}
                            >
                              {isBuy ? "BUY" : "SELL"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-[var(--text)]">
                            {order.amountSell}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)] text-xs">
                              <Lock size={11} className="text-[var(--text)]/60" />
                              Encrypted
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <button
                              onClick={() => {
                                setSelectedOrder(order);
                                setTakerPrice("");
                                setModalView("fill");
                              }}
                              className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium
                                         bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)]
                                         hover:bg-[var(--bg-alt)] hover:border-[var(--border-dash)] transition-all"
                            >
                              <ShoppingCart size={12} />
                              Fill Order
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer note */}
            <div className="px-5 py-3 border-t border-[var(--border-dash)] flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <Lock size={10} className="text-[var(--text)]/40" />
              All prices are encrypted on-chain via FHE. Only order owners can view their own price.
            </div>
          </div>

          {/* ================= CREATE ORDER FORM (right 1/3) ================= */}
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 space-y-5 h-fit sticky top-24">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-[var(--text)]" />
              <h2 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
                Create Order
              </h2>
            </div>

            {/* Side toggle */}
            <div className="flex rounded overflow-hidden border border-[var(--border-dash)]">
              <button
                type="button"
                onClick={() => setSide(0)}
                className={`flex-1 py-2.5 text-sm font-bold tracking-wide transition-all ${
                  side === 0
                    ? "bg-[var(--bg-alt)] text-[var(--text)] border-r border-[var(--border-dash)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard border-r border-[var(--border-dash)]"
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setSide(1)}
                className={`flex-1 py-2.5 text-sm font-bold tracking-wide transition-all ${
                  side === 1
                    ? "bg-[var(--bg-alt)] text-[var(--text-muted)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard"
                }`}
              >
                SELL
              </button>
            </div>

            <TokenDropdown
              label="Token to Sell"
              value={sellToken}
              onChange={setSellToken}
            />
            <TokenDropdown
              label="Token to Buy"
              value={buyToken}
              onChange={setBuyToken}
            />

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-muted)] font-medium">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                           text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                           focus:outline-none focus:border-[var(--border-dash)] transition-colors"
              />
            </div>

            {/* Price */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                <Lock size={10} className="text-[var(--text)]" />
                Price per unit
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                           text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                           focus:outline-none focus:border-[var(--border-dash)] transition-colors"
              />
              <p className="text-[10px] text-[var(--text)]/60 flex items-center gap-1">
                <Lock size={8} />
                Encrypted on submit -- nobody sees your price
              </p>
            </div>

            {/* Submit */}
            <button
              onClick={handleCreateOrder}
              disabled={
                !initialized ||
                !amount ||
                !price ||
                !sellToken ||
                !buyToken ||
                encrypting ||
                txState === "signing" ||
                txState === "confirming"
              }
              className="w-full rounded py-3 text-sm font-semibold text-[var(--bg)]
                         bg-[var(--text)]
                          
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all duration-200 flex items-center justify-center gap-2"
            >
              {encrypting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Processing...
                </>
              ) : txState === "signing" ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Processing...
                </>
              ) : txState === "confirming" ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Lock size={14} />
                  Encrypt &amp; Submit
                </>
              )}
            </button>

            {/* Privacy note */}
            <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3 space-y-1">
              <p className="text-[10px] text-[var(--text)]/60 leading-relaxed">
                Your price is encrypted client-side via cofhejs and submitted
                as a ciphertext. The contract uses FHE.gte() to match orders
                without decrypting either price.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================= MY ORDERS ================= */}
      {account && myOrders.length > 0 && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-dash)]">
            <h2 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
              My Orders
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-dash)]">
                  <th className="text-left px-5 py-3 font-medium">ID</th>
                  <th className="text-left px-5 py-3 font-medium">Pair</th>
                  <th className="text-left px-5 py-3 font-medium">Side</th>
                  <th className="text-right px-5 py-3 font-medium">Amount</th>
                  <th className="text-right px-5 py-3 font-medium">
                    Price
                  </th>
                  <th className="text-center px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {myOrders.map((order) => {
                  const isBuy = order.side === 0;
                  return (
                    <tr
                      key={order.id}
                      className="border-b border-[var(--border-dash)] hover:bg-bgCard transition-colors"
                    >
                      <td className="px-5 py-3.5 font-mono text-[var(--text-muted)] text-xs">
                        #{order.id}
                      </td>
                      <td className="px-5 py-3.5 text-[var(--text)] font-medium">
                        {tokenSymbol(order.tokenSell)}/{tokenSymbol(order.tokenBuy)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold tracking-wide ${
                            isBuy
                              ? "bg-[var(--bg-alt)] text-[var(--text)] border border-[var(--border-dash)]"
                              : "bg-[var(--bg-alt)] text-[var(--text-muted)] border border-[var(--border-dash)]"
                          }`}
                        >
                          {isBuy ? "BUY" : "SELL"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[var(--text)]">
                        {order.amountSell}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {order.unsealedPrice !== null ? (
                          <span className="font-mono text-[var(--text)]">
                            {order.unsealedPrice}
                          </span>
                        ) : (
                          <button
                            onClick={() => unsealPrice(order)}
                            disabled={unsealing || !initialized}
                            className="inline-flex items-center gap-1.5 text-xs text-[var(--text)]
                                       hover:text-[var(--text)] transition-colors disabled:opacity-50"
                          >
                            <Eye size={12} />
                            View Price
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)]
                                     hover:bg-[var(--bg-alt)] hover:border-[var(--border-dash)] transition-all"
                        >
                          <Trash2 size={12} />
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= FILL ORDER MODAL ================= */}
      <AnimatePresence>
        {modalView === "fill" && selectedOrder && (
          <motion.div
            key="fill-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => {
              setModalView("none");
              setSelectedOrder(null);
            }}
          >
            <motion.div
              key="fill-panel"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-6 space-y-5 "
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <ShoppingCart size={18} className="text-[var(--text)]" />
                  Fill Order #{selectedOrder.id}
                </h3>
                <button
                  onClick={() => {
                    setModalView("none");
                    setSelectedOrder(null);
                  }}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1 rounded hover:bg-bgCard"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Order details card */}
              <div className="space-y-2.5 rounded bg-[var(--bg)]/80 p-4 border border-[var(--border-dash)]">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Pair</span>
                  <span className="text-[var(--text)] font-medium">
                    {tokenSymbol(selectedOrder.tokenSell)}/
                    {tokenSymbol(selectedOrder.tokenBuy)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Amount</span>
                  <span className="font-mono text-[var(--text)]">
                    {selectedOrder.amountSell}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Maker</span>
                  <span className="font-mono text-[var(--text-muted)] text-xs">
                    {shortAddr(selectedOrder.maker)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Maker&apos;s Price</span>
                  <span className="inline-flex items-center gap-1 text-[var(--text)]/80 text-xs">
                    <Lock size={11} />
                    Hidden
                  </span>
                </div>
              </div>

              {/* Taker price input */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                  <Lock size={10} className="text-[var(--text)]" />
                  Your Price
                </label>
                <input
                  type="number"
                  value={takerPrice}
                  onChange={(e) => setTakerPrice(e.target.value)}
                  placeholder="Enter your price"
                  min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              {/* Privacy explanation */}
              <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3">
                <p className="text-xs text-[var(--text)]/80 leading-relaxed">
                  If your price &gt;= the maker&apos;s hidden price, the trade
                  executes via FHE. If not, nothing happens -- neither party
                  sees the other&apos;s price.
                </p>
              </div>

              {/* Encryption progress */}
              <EncryptionProgress stage={stage} visible={encrypting} />

              {/* Submit */}
              <button
                onClick={handleFillOrder}
                disabled={
                  !initialized ||
                  !takerPrice ||
                  encrypting ||
                  txState === "signing" ||
                  txState === "confirming"
                }
                className="w-full rounded py-3 text-sm font-semibold text-[var(--bg)]
                           bg-[var(--text)]
                            
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-all duration-200 flex items-center justify-center gap-2"
              >
                {encrypting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Processing...
                  </>
                ) : txState === "signing" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock size={14} />
                    Encrypt &amp; Submit
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
