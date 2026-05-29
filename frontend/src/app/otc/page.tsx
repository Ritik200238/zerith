"use client";

// Skip Next.js static prerender — this page is entirely wallet-driven,
// has zero static value, and prerender was hitting an opaque SSR error in
// production build. Same is true for all wallet-bound pages but we only
// disable on the ones that hit issues to keep build time reasonable.
export const dynamic = "force-dynamic";

/**
 * OTC Desk — /otc
 *
 * Encrypted-price RFQ for large block trades. Requester posts an
 * encrypted (amount, min-price, max-price) request. Quoters submit
 * encrypted (price, amount) quotes. Requester accepts the best.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Plus, X, Loader2, RefreshCw, Lock, Clock, CheckCircle2, AlertCircle,
  Send, ArrowLeftRight,
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
import { TxFlowDrawer, type TxFlowStep } from "@/components/shared/TxFlowDrawer";
import { useTxFlow } from "@/hooks/useTxFlow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { PrivacyLens } from "@/components/shared/PrivacyLens";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";
import { parseAmount, isValidAddress, shortAddress, formatRemaining } from "@/lib/format";

interface RequestData {
  id: number;
  requester: string;
  tokenWant: string;
  tokenOffer: string;
  status: number; // 0 ACTIVE 1 MATCHED 2 CANCELLED 3 EXPIRED
  deadline: number;
  quoteCount: number;
}

const STATUS_LABEL: Record<number, string> = { 0: "ACTIVE", 1: "MATCHED", 2: "CANCELLED", 3: "EXPIRED" };
const STATUS_STYLE: Record<number, React.CSSProperties> = {
  0: { color: "var(--text)", background: "var(--bg-card)", border: "1px dashed var(--border-dash)" },
  1: { color: "var(--text)", background: "var(--bg-alt)", border: "1px dashed var(--border-dash)" },
  2: { color: "var(--text-muted)", background: "var(--bg-alt)", border: "1px dashed var(--border-dash)" },
  3: { color: "var(--text-muted)", background: "var(--bg-alt)", border: "1px dashed var(--border-dash)" },
};

type ModalView = "none" | "post" | "quote" | "quotes-picker";

interface QuoteRow {
  index: number;
  quoter: string;
  encQuotePrice: string;
  encQuoteAmount: string;
  accepted: boolean;
}

export default function OTCPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const { unseal } = useUnseal();
  const toast = useToast();

  const otcContract = useContract("OTCBoard");
  const otcRead = useReadContract("OTCBoard");

  const deployed = CONTRACTS.OTCBoard !== "0x0000000000000000000000000000000000000000";

  const [requests, setRequests] = useState<RequestData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedRequest, setSelectedRequest] = useState<RequestData | null>(null);

  // post request form
  const [tokenWant, setTokenWant] = useState(CONTRACTS.ConfidentialToken);
  const [tokenOffer, setTokenOffer] = useState(CONTRACTS.ConfidentialToken);
  const [reqAmount, setReqAmount] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [reqDeadline, setReqDeadline] = useState("3600");

  // quote form
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "OTC Desk", type: "trade", href: "/otc", txHash });
  // 4-step encrypted-quote progress drawer state
  const [quoteFlowStep, setQuoteFlowStep] = useState<TxFlowStep>("idle");
  const [quoteFlowError, setQuoteFlowError] = useState<string | undefined>();
  const [quoteFlowTxHash, setQuoteFlowTxHash] = useState<string | undefined>();
  const postFlow = useTxFlow();

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "otc-modal-title");

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchRequests = useCallback(async () => {
    if (!otcRead) return;
    try {
      const count = Number(await otcRead.getRequestCount());
      // Parallel fetch with per-item resilience — a single bad index does
      // not block the whole page render.
      const indices = Array.from({ length: count }, (_, i) => i);
      const raws = await Promise.all(
        indices.map((i) => otcRead.getRequest(i).catch(() => null)),
      );
      const out: RequestData[] = [];
      raws.forEach((r, i) => {
        if (!r) return;
        out.push({
          id: i,
          requester: r[0],
          tokenWant: r[1],
          tokenOffer: r[2],
          status: Number(r[3]),
          deadline: Number(r[4]),
          quoteCount: Number(r[5]),
        });
      });
      setRequests(out.reverse());
    } catch {
      /* noop */
    }
  }, [otcRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchRequests();
  }, [fetchRequests, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handlePost = useCallback(async () => {
    if (!otcContract || !initialized) return;
    if (!isValidAddress(tokenWant) || !isValidAddress(tokenOffer)) {
      toast.error("Invalid tokens", "Both must be 0x + 40 hex");
      return;
    }
    if (tokenWant === tokenOffer) {
      toast.error("Invalid pair", "Tokens must differ");
      return;
    }
    const amountBn = parseAmount(reqAmount);
    const minBn = parseAmount(minPrice);
    const maxBn = parseAmount(maxPrice);
    if (amountBn === null || minBn === null || maxBn === null) {
      toast.error("Invalid input", "Amount + prices must be positive numbers");
      return;
    }
    const dur = Number(reqDeadline);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid deadline", "≥ 60 seconds");
      return;
    }
    setTxState("signing");
    postFlow.begin();
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([
        Encryptable.uint128(amountBn),
        Encryptable.uint128(minBn),
        Encryptable.uint128(maxBn),
      ]);
      if (!enc) throw new Error("Encryption failed");

      postFlow.submitted();
      const deadlineTs = Math.floor(Date.now() / 1000) + dur;
      const tx = await otcContract.postRequest(tokenWant, tokenOffer, enc[0], enc[1], enc[2], BigInt(deadlineTs));
      setTxState("confirming");
      setTxHash(tx.hash);
      postFlow.confirmed(tx.hash);
      await tx.wait();
      setTxState("success");
      postFlow.sealed();
      setReqAmount("");
      setMinPrice("");
      setMaxPrice("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      postFlow.failed(err);
      toast.error("Post request failed", msg);
    }
  }, [otcContract, initialized, tokenWant, tokenOffer, reqAmount, minPrice, maxPrice, reqDeadline, encrypt, toast, postFlow]);

  const handleQuote = useCallback(async () => {
    if (!otcContract || !initialized || !selectedRequest) return;
    const priceBn = parseAmount(quotePrice);
    const amtBn = parseAmount(quoteAmount);
    if (priceBn === null || amtBn === null) {
      toast.error("Invalid input", "Price and amount must be positive numbers");
      return;
    }
    setTxState("signing");
    setQuoteFlowStep("encrypt");
    setQuoteFlowError(undefined);
    setQuoteFlowTxHash(undefined);
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(priceBn), Encryptable.uint128(amtBn)]);
      if (!enc) throw new Error("Encryption failed");
      setQuoteFlowStep("submit");
      const tx = await otcContract.submitQuote(selectedRequest.id, enc[0], enc[1]);
      setTxState("confirming");
      setTxHash(tx.hash);
      setQuoteFlowStep("confirm");
      setQuoteFlowTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setQuoteFlowStep("sealed");
      setQuotePrice("");
      setQuoteAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      setQuoteFlowStep("error");
      setQuoteFlowError(msg);
      toast.error("Quote failed", msg);
    }
  }, [otcContract, initialized, selectedRequest, quotePrice, quoteAmount, encrypt, toast]);

  const closeQuoteFlow = useCallback(() => {
    setQuoteFlowStep("idle");
    setQuoteFlowError(undefined);
    setQuoteFlowTxHash(undefined);
  }, []);

  const handleAccept = useCallback(
    async (req: RequestData, quoteIndex: number) => {
      if (!otcContract) return;
      // Keep the picker modal open through the whole tx so the row shows a
      // live spinner; only close + refresh once the receipt resolves.
      setAcceptingIndex(quoteIndex);
      setTxState("signing");
      try {
        const tx = await otcContract.acceptQuote(req.id, quoteIndex);
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
        toast.error("Accept failed", msg);
      } finally {
        setAcceptingIndex(null);
      }
    },
    [otcContract, toast],
  );

  const handleCancel = useCallback(
    async (req: RequestData) => {
      if (!otcContract) return;
      setTxState("signing");
      try {
        const tx = await otcContract.cancelRequest(req.id);
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
    [otcContract, toast],
  );

  /** Permissionless sweep — anyone can mark a past-deadline request as EXPIRED. */
  const handleExpire = useCallback(
    async (req: RequestData) => {
      if (!otcContract) return;
      setTxState("signing");
      try {
        const tx = await otcContract.expireRequest(req.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        toast.success("Request expired", `Request #${req.id} swept to EXPIRED.`);
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Expire failed", msg);
      }
    },
    [otcContract, toast],
  );

  /** Load all quotes for a request and open the picker modal. Fixes the audit
   *  bug where requester could only "Accept first quote" (hardcoded index 0). */
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>([]);
  // Index of the quote row currently being accepted — drives the per-row
  // spinner and disables every Accept button while the tx is in flight.
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const openQuotesPicker = useCallback(
    async (req: RequestData) => {
      if (!otcRead) return;
      setSelectedRequest(req);
      setQuoteRows([]);
      setAcceptingIndex(null);
      setModalView("quotes-picker");
      try {
        const indices = Array.from({ length: req.quoteCount }, (_, i) => i);
        const raws = await Promise.all(
          indices.map((i) => otcRead.getQuote(req.id, i)),
        );
        const rows: QuoteRow[] = raws.map((q, i) => ({
          index: i,
          quoter: q[0],
          encQuotePrice: q[1].toString(),
          encQuoteAmount: q[2].toString(),
          accepted: q[3],
        }));
        setQuoteRows(rows);
      } catch (err: unknown) {
        toast.error("Could not load quotes", err instanceof Error ? err.message.slice(0, 200) : "Read failed");
      }
    },
    [otcRead, toast],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto px-5 md:px-10 py-12 max-w-[1180px]">
        <ComingSoonBanner feature="OTC Desk" shipDate="soon" />
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — OTC Desk
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Large trades,{" "}
              <em className="font-serif italic font-normal">hidden quotes</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Post an encrypted RFQ with a price range. Receive encrypted quotes from anyone.
              Pick the best, swap atomically. Other quoters never see competing prices —
              competition without leakage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <FaucetButton />
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              aria-label="Refresh"
              className="p-3 transition-colors"
              style={{
                border: "1px dashed var(--border-dash)",
                borderRadius: 8,
                color: "var(--text-muted)",
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setModalView("post")}
              disabled={!account}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
            >
              <Plus size={14} /> New request
            </button>
          </div>
        </div>
      </header>

      <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} className="mb-10" />

      {/* PRIVACY LENS — bound to the most recent request, or example data if none exist */}
      <section className="mb-10">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] mb-4" style={{ color: "var(--text-muted)" }}>
          — Privacy lens · sample OTC request
        </div>
        {(() => {
          const r = requests[0];
          const want = r ? shortAddress(r.tokenWant) : "0xToken…A";
          const offer = r ? shortAddress(r.tokenOffer) : "0xToken…B";
          const requester = r ? shortAddress(r.requester) : "0x…";
          return (
            <PrivacyLens
              title="What each role sees about an OTC request"
              rows={[
                {
                  label: "Token pair",
                  meValue: `${want} / ${offer}`,
                  counterpartyValue: `${want} / ${offer}`,
                  observerValue: `${want} / ${offer}`,
                  encrypted: false,
                },
                {
                  label: "Requester",
                  meValue: requester,
                  counterpartyValue: requester,
                  observerValue: requester,
                  encrypted: false,
                },
                {
                  label: "Order size",
                  meValue: "Your exact size",
                  counterpartyValue: "sealed (only the matched amount is revealed post-trade)",
                  observerValue: "sealed",
                  encrypted: true,
                },
                {
                  label: "Price range",
                  meValue: "Your min / max",
                  counterpartyValue: "sealed (their quote settles iff in range, zero otherwise)",
                  observerValue: "sealed",
                  encrypted: true,
                },
                {
                  label: "Quote price (when quoter)",
                  meValue: "Your quoted price (unsealable by you)",
                  counterpartyValue: "Your quote — readable; their range — sealed",
                  observerValue: "sealed",
                  encrypted: true,
                },
                {
                  label: "Match outcome",
                  meValue: r && r.status === 1 ? "MATCHED" : r ? "Pending" : "—",
                  counterpartyValue: r && r.status === 1 ? "MATCHED" : r ? "Pending" : "—",
                  observerValue: r && r.status === 1 ? "MATCHED" : r ? "Pending" : "—",
                  encrypted: false,
                },
              ]}
            />
          );
        })()}
      </section>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="grid gap-4">
        {requests.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            eyebrow="No OTC requests yet"
            title="Post a sealed RFQ — counterparties never see your range."
            body="Define the pair and an encrypted price band. Market makers submit sealed quotes; FHE checks each quote against your range on-chain; only the matched quote ever decrypts. Bands, losing quotes, and bidder identity stay hidden."
            primary={{ label: "New request", onClick: () => setModalView("post") }}
            secondary={{ label: "First time? Run the quickstart", href: "/quickstart" }}
          />
        ) : (
          requests.map((r) => {
            const style = STATUS_STYLE[r.status];
            const isMine = account && account.toLowerCase() === r.requester.toLowerCase();
            return (
              <article
                key={r.id}
                className="p-6"
                style={{
                  background: "var(--bg-card)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: "var(--text-muted)" }}
                    >
                      #{r.id}
                    </span>
                    <span
                      className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] font-medium"
                      style={{ ...style, borderRadius: 4 }}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: "var(--text-muted)" }}
                    >
                      by {shortAddress(r.requester)}
                    </span>
                    {isMine && (
                      <span
                        className="text-[10px] font-mono uppercase tracking-[0.1em]"
                        style={{ color: "var(--text)" }}
                      >
                        yours
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[11px] flex items-center gap-1.5 font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Clock size={11} />
                    {r.status === 0 ? formatRemaining(r.deadline) : "ended"}
                  </span>
                </div>
                <div className="mt-5 grid md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <div
                      className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Want
                    </div>
                    <div className="font-mono" style={{ color: "var(--text)" }}>
                      {shortAddress(r.tokenWant)}
                    </div>
                  </div>
                  <div>
                    <div
                      className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Offer
                    </div>
                    <div className="font-mono" style={{ color: "var(--text)" }}>
                      {shortAddress(r.tokenOffer)}
                    </div>
                  </div>
                  <div>
                    <div
                      className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Quotes
                    </div>
                    <div
                      className="font-display text-lg font-semibold"
                      style={{ color: "var(--text)" }}
                    >
                      {r.quoteCount}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2 flex-wrap">
                  {r.status === 0 && account && !isMine && (
                    <button
                      onClick={() => {
                        setSelectedRequest(r);
                        setModalView("quote");
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                    >
                      <Send size={11} /> Submit quote
                    </button>
                  )}
                  {r.status === 0 && isMine && r.quoteCount > 0 && (
                    <button
                      onClick={() => openQuotesPicker(r)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                    >
                      <CheckCircle2 size={11} /> Choose quote ({r.quoteCount})
                    </button>
                  )}
                  {r.status === 0 && isMine && (
                    <button
                      onClick={() => handleCancel(r)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors"
                      style={{
                        background: "transparent",
                        border: "1px dashed var(--border-dash)",
                        color: "var(--text-muted)",
                        borderRadius: 8,
                      }}
                    >
                      <X size={11} /> Cancel
                    </button>
                  )}
                  {r.status === 0 && r.deadline > 0 && Math.floor(Date.now() / 1000) >= r.deadline && (
                    <button
                      onClick={() => handleExpire(r)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors"
                      style={{
                        background: "transparent",
                        border: "1px dashed var(--border-dash)",
                        color: "var(--text-muted)",
                        borderRadius: 8,
                      }}
                      title="Anyone can sweep expired requests"
                    >
                      <Clock size={11} /> Sweep expired
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
            style={{ background: "rgba(17, 17, 17, 0.4)" }}
            onClick={() => setModalView("none")}
            {...modalProps}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md p-7 space-y-5 max-h-[90vh] overflow-y-auto"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 4,
              }}
            >
              {modalView === "post" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3
                      id="otc-modal-title"
                      className="font-display text-xl font-semibold flex items-center gap-2"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      <Users size={16} style={{ color: "var(--text-muted)" }} /> New OTC request
                    </h3>
                    <button
                      onClick={() => setModalView("none")}
                      aria-label="Close modal"
                      className="p-1 rounded transition-colors hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {[
                    { label: "Token you want", value: tokenWant, set: setTokenWant, placeholder: "0x...", mono: true },
                    { label: "Token you offer", value: tokenOffer, set: setTokenOffer, placeholder: "0x...", mono: true },
                  ].map((f) => (
                    <div key={f.label} className="space-y-2">
                      <label
                        className="font-mono text-[10px] uppercase tracking-[0.1em]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {f.label}
                      </label>
                      <input
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.placeholder}
                        className={`w-full px-3 py-2.5 text-sm focus:outline-none ${f.mono ? "font-mono" : ""}`}
                        style={{
                          background: "var(--bg)",
                          border: "1px dashed var(--border-dash)",
                          borderRadius: 4,
                          color: "var(--text)",
                        }}
                      />
                    </div>
                  ))}
                  <div className="space-y-2">
                    <label
                      className="font-mono text-[10px] uppercase tracking-[0.1em] flex items-center gap-1.5"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Lock size={10} /> Amount wanted [ENCRYPTED]
                    </label>
                    <input
                      value={reqAmount}
                      onChange={(e) => setReqAmount(e.target.value)}
                      placeholder="500"
                      className="w-full px-3 py-2.5 text-sm focus:outline-none"
                      style={{
                        background: "var(--bg)",
                        border: "1px dashed var(--border-dash)",
                        borderRadius: 4,
                        color: "var(--text)",
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Min price", value: minPrice, set: setMinPrice, placeholder: "100" },
                      { label: "Max price", value: maxPrice, set: setMaxPrice, placeholder: "200" },
                    ].map((f) => (
                      <div key={f.label} className="space-y-2">
                        <label
                          className="font-mono text-[10px] uppercase tracking-[0.1em] flex items-center gap-1.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Lock size={10} /> {f.label}
                        </label>
                        <input
                          value={f.value}
                          onChange={(e) => f.set(e.target.value)}
                          placeholder={f.placeholder}
                          className="w-full px-3 py-2.5 text-sm focus:outline-none"
                          style={{
                            background: "var(--bg)",
                            border: "1px dashed var(--border-dash)",
                            borderRadius: 4,
                            color: "var(--text)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <label
                      className="font-mono text-[10px] uppercase tracking-[0.1em]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Deadline (seconds from now)
                    </label>
                    <input
                      value={reqDeadline}
                      onChange={(e) => setReqDeadline(e.target.value)}
                      type="number"
                      min={60}
                      className="w-full px-3 py-2.5 text-sm focus:outline-none"
                      style={{
                        background: "var(--bg)",
                        border: "1px dashed var(--border-dash)",
                        borderRadius: 4,
                        color: "var(--text)",
                      }}
                    />
                  </div>
                  {!initialized && (
                    <div
                      className="p-3 flex items-center gap-2 text-xs"
                      style={{
                        background: "var(--bg-alt)",
                        border: "1px dashed var(--border-dash)",
                        borderRadius: 4,
                      }}
                    >
                      <AlertCircle size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                      <span style={{ color: "var(--text-muted)" }}>Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button
                    onClick={handlePost}
                    disabled={!initialized || !reqAmount || !minPrice || !maxPrice || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                  >
                    {txState === "signing" || txState === "confirming" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    Encrypt &amp; post
                  </button>
                </>
              )}

              {modalView === "quote" && selectedRequest && (
                <>
                  <div className="flex items-center justify-between">
                    <h3
                      className="font-display text-xl font-semibold flex items-center gap-2"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      <Send size={16} style={{ color: "var(--text-muted)" }} /> Submit quote
                    </h3>
                    <button
                      onClick={() => setModalView("none")}
                      aria-label="Close modal"
                      className="p-1 rounded transition-colors hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {[
                    { label: "Price per unit [ENCRYPTED]", value: quotePrice, set: setQuotePrice, placeholder: "150" },
                    { label: "Amount offered [ENCRYPTED]", value: quoteAmount, set: setQuoteAmount, placeholder: "500" },
                  ].map((f) => (
                    <div key={f.label} className="space-y-2">
                      <label
                        className="font-mono text-[10px] uppercase tracking-[0.1em] flex items-center gap-1.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Lock size={10} /> {f.label}
                      </label>
                      <input
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2.5 text-sm focus:outline-none"
                        style={{
                          background: "var(--bg)",
                          border: "1px dashed var(--border-dash)",
                          borderRadius: 4,
                          color: "var(--text)",
                        }}
                      />
                    </div>
                  ))}
                  <button
                    onClick={handleQuote}
                    disabled={!initialized || !quotePrice || !quoteAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                  >
                    {txState === "signing" || txState === "confirming" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Encrypt &amp; submit
                  </button>
                </>
              )}

              {modalView === "quotes-picker" && selectedRequest && (
                <>
                  <div className="flex items-center justify-between">
                    <h3
                      className="font-display text-xl font-semibold flex items-center gap-2"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      <CheckCircle2 size={16} style={{ color: "var(--text-muted)" }} />
                      Choose a quote
                    </h3>
                    <button
                      onClick={() => setModalView("none")}
                      aria-label="Close modal"
                      className="p-1 rounded transition-colors hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Quote prices are encrypted on-chain. Tap <em>Unseal</em> to view each one locally
                    (your permit grants access), then accept the best.
                  </p>
                  {quoteRows.length === 0 ? (
                    <div className="py-8 text-center font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Loading quotes…
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {quoteRows.map((q) => (
                        <QuoteRowCard
                          key={q.index}
                          row={q}
                          unseal={unseal}
                          accepting={acceptingIndex === q.index}
                          anyAccepting={acceptingIndex !== null}
                          onAccept={() => {
                            void handleAccept(selectedRequest, q.index);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4-step encrypted-request progress drawer */}
      <TxFlowDrawer
        open={postFlow.step !== "idle"}
        step={postFlow.step}
        subjectNoun="request"
        title={postFlow.step === "sealed" ? "Request posted" : "Sealing your OTC request"}
        txHash={postFlow.txHash}
        chainId={FHENIX_TESTNET.chainId}
        errorMessage={postFlow.errorMessage}
        onClose={postFlow.close}
        onRetry={() => { postFlow.close(); void handlePost(); }}
      />

      {/* 4-step encrypted-quote progress drawer */}
      <TxFlowDrawer
        open={quoteFlowStep !== "idle"}
        step={quoteFlowStep}
        subjectNoun="quote"
        title={
          quoteFlowStep === "sealed"
            ? "Quote submitted privately"
            : "Sealing your price + amount"
        }
        txHash={quoteFlowTxHash}
        chainId={FHENIX_TESTNET.chainId}
        errorMessage={quoteFlowError}
        onClose={closeQuoteFlow}
        onRetry={() => {
          closeQuoteFlow();
          void handleQuote();
        }}
      />
    </main>
  );
}

/** Single quote row in the picker modal. Lets the requester unseal price+amount
 *  client-side (cofhejs uses their permit, granted at submitQuote time via FHE.allow)
 *  and accept the best one. */
function QuoteRowCard({
  row,
  unseal,
  onAccept,
  accepting,
  anyAccepting,
}: {
  row: QuoteRow;
  unseal: (h: bigint, t: number) => Promise<bigint | null>;
  onAccept: () => void;
  /** This specific row's accept tx is in flight — show the inline spinner. */
  accepting: boolean;
  /** Some row is being accepted — disable every Accept button until it settles. */
  anyAccepting: boolean;
}) {
  const [price, setPrice] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUnseal = async () => {
    setBusy(true);
    try {
      const p = await unseal(BigInt(row.encQuotePrice), 6); // Uint128
      const a = await unseal(BigInt(row.encQuoteAmount), 6);
      if (p !== null) setPrice(p.toString());
      if (a !== null) setAmount(a.toString());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="p-3 flex items-center justify-between gap-3"
      style={{ border: "1px dashed var(--border-dash)", borderRadius: 4, background: "var(--bg-card)" }}
    >
      <div className="space-y-1 min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
          QUOTER · {row.quoter.slice(0, 6)}…{row.quoter.slice(-4)}
        </div>
        <div className="text-sm">
          Price:&nbsp;
          {price !== null ? (
            <span className="font-mono" style={{ color: "var(--text)" }}>{price}</span>
          ) : (
            <span className="font-mono" style={{ color: "var(--text-muted)" }}>sealed</span>
          )}
          &nbsp;·&nbsp;Amount:&nbsp;
          {amount !== null ? (
            <span className="font-mono" style={{ color: "var(--text)" }}>{amount}</span>
          ) : (
            <span className="font-mono" style={{ color: "var(--text-muted)" }}>sealed</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {price === null && (
          <button
            onClick={handleUnseal}
            disabled={busy}
            className="px-3 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ border: "1px dashed var(--border-dash)", borderRadius: 6 }}
          >
            {busy ? "…" : "Unseal"}
          </button>
        )}
        <button
          onClick={onAccept}
          disabled={row.accepted || anyAccepting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 6 }}
        >
          {accepting && <Loader2 size={11} className="animate-spin" />}
          {row.accepted ? "Accepted" : accepting ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
