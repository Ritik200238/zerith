"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  Lock,
  X,
  Plus,
  Loader2,
  Timer,
  Users,
  ChevronDown,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  Zap,
  Shield,
  Info,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useContract, useReadContract } from "@/hooks/useContract";
import { EncryptionProgress } from "@/components/shared/EncryptionProgress";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { TxFlowDrawer } from "@/components/shared/TxFlowDrawer";
import { useTxFlow } from "@/hooks/useTxFlow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { RevealAnimation } from "@/components/shared/RevealAnimation";
import {
  SignatureDrawer,
  type SignatureProof,
} from "@/components/shared/SignatureDrawer";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";
import { formatAmount, parseAmount } from "@/lib/format";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { ethers } from "ethers";

/* ------------------------------------------------------------------ */
/*  Types */
/* ------------------------------------------------------------------ */

interface VickreyAuctionData {
  id: number;
  seller: string;
  token: string;
  paymentToken: string;
  amount: string;
  deadline: number;
  bidCount: number;
  status: number; // 0=OPEN 1=CLOSED 2=REVEALED 3=SETTLED 4=CANCELLED
  winnerBid: string;
  winner: string;
  secondPrice: string;
  myBidUnsealed: string | null;
}

type ModalView = "none" | "create" | "bid" | "detail";

/* ------------------------------------------------------------------ */
/*  Constants */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<number, string> = {
  0: "OPEN", 1: "CLOSED", 2: "REVEALED", 3: "SETTLED", 4: "CANCELLED",
};
const STATUS_STYLE: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  3: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]", border: "border-borderDash" },
  4: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
};

const DURATION_OPTS = [
  { label: "5 min",  value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
  { label: "24 hrs", value: 86400 },
];

const TOKEN_OPTIONS = [
  { label: "CDEX", address: CONTRACTS.ConfidentialToken, symbol: "CDEX" },
  { label: "MOCK", address: CONTRACTS.MockToken, symbol: "MOCK" },
];

function tokenSymbol(addr: string): string {
  const hit = TOKEN_OPTIONS.find((t) => t.address.toLowerCase() === addr.toLowerCase());
  return hit ? hit.symbol : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  Countdown */
/* ------------------------------------------------------------------ */

function useCountdown(deadline: number): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = deadline - now;
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function CountdownBadge({ deadline }: { deadline: number }) {
  const str = useCountdown(deadline);
  const now = Math.floor(Date.now() / 1000);
  const ended = deadline <= now;
  const urgent = !ended && deadline - now < 60;
  return (
    <span className={`font-mono text-xs ${ended ? "text-[var(--text-muted)]" : urgent ? "text-[var(--text-muted)] animate-pulse" : "text-[var(--text)]"}`}>
      {str}
    </span>
  );
}

/* ================================================================== */
/*  VickreyAuctionsPage */
/* ================================================================== */

export default function VickreyAuctionsPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const { decrypt: decryptForTx } = useDecryptForTx();
  const auctionContract = useContract("VickreyAuction");
  const auctionRead = useReadContract("VickreyAuction");

  const [auctions, setAuctions] = useState<VickreyAuctionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [modalView, setModalView] = useState<ModalView>("none");
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));
  const [selectedAuction, setSelectedAuction] = useState<VickreyAuctionData | null>(null);

  /* ---- create form ---- */
  const [cToken, setCToken] = useState<string>(CONTRACTS.ConfidentialToken);
  const [cPayToken, setCPayToken] = useState<string>("");
  const [cAmount, setCAmount] = useState("");
  const [cDuration, setCDuration] = useState(3600);

  const [bidAmount, setBidAmount] = useState("");
  const [revealActive, setRevealActive] = useState(false);

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Vickrey Auction", type: "auction", href: "/vickrey", txHash });
  const [txError, setTxError] = useState<string | undefined>();
  const bidFlow = useTxFlow();

  /* ---- signature drawer (verifiable reveal proof) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProof, setDrawerProof] = useState<SignatureProof | null>(null);

  const busyRef = useRef<Set<string>>(new Set());
  const deployed = CONTRACTS.VickreyAuction !== "0x0000000000000000000000000000000000000000";
  const nowSec = Math.floor(Date.now() / 1000);

  const isSeller = (a: VickreyAuctionData) =>
    account !== null && a.seller.toLowerCase() === account.toLowerCase();

  /* ---------------------------------------------------------------- */
  /*  Fetch */
  /* ---------------------------------------------------------------- */

  const fetchAuctions = useCallback(async () => {
    if (!auctionRead) return;
    setLoading(true);
    try {
      const total = Number(await auctionRead.getAuctionCount());
      const list: VickreyAuctionData[] = [];
      for (let i = 0; i < total; i++) {
        const a = await auctionRead.getAuction(i);
        list.push({
          id: i,
          seller: a[0],
          token: a[1],
          paymentToken: a[2],
          amount: a[3].toString(),
          deadline: Number(a[4]),
          bidCount: Number(a[5]),
          status: Number(a[6]),
          winnerBid: a[7].toString(),
          winner: a[8],
          secondPrice: a[9].toString(),
          myBidUnsealed: null,
        });
      }
      list.reverse();
      setAuctions(list);
    } catch {
      setAuctions([]);
    } finally {
      setLoading(false);
    }
  }, [auctionRead]);

  const blockTick = useBlockPoll();
  useEffect(() => { fetchAuctions(); }, [fetchAuctions, refreshKey, blockTick]);

  useAccountChangeReset(useCallback(() => {
    setAuctions((prev) => prev.map((a) => ({ ...a, myBidUnsealed: null })));
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /*  Tx helpers */
  /* ---------------------------------------------------------------- */

  const toast = useToast();

  function handleTxError(err: unknown) {
    const isRejection = err instanceof Error && err.message.includes("user rejected");
    const message = isRejection
      ? "You rejected the transaction in your wallet"
      : err instanceof Error ? err.message.slice(0, 200) : "Transaction failed";
    setTxState("error");
    setTxError(message);
    toast.error(isRejection ? "Transaction cancelled" : "Transaction failed", message);
  }

  const guardedAction = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      setTxState("signing");
      setTxError(undefined);
      setTxHash(undefined);
      try {
        await fn();
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        handleTxError(err);
      } finally {
        busyRef.current.delete(key);
      }
    },
    [],
  );

  /* ---- actions ---- */

  const handleCreate = useCallback(async () => {
    if (!auctionContract || !cToken || !cPayToken || !cAmount) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    try {
      // Audit fix G1: validate decimal-friendly amount
      const amountBn = parseAmount(cAmount);
      if (amountBn === null) {
        toast.error("Invalid amount", "Amount must be a positive number");
        setTxState("idle");
        return;
      }
      // Contract signature: (token, paymentToken, amount, duration, snipeExtension)
      // 0 means use DEFAULT_SNIPE_EXTENSION internally.
      const tx = await auctionContract.createAuction(
        cToken, cPayToken, amountBn, BigInt(cDuration), BigInt(0),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setCAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [auctionContract, cToken, cPayToken, cAmount, cDuration]);

  const handleBid = useCallback(async () => {
    if (!auctionContract || !initialized || !selectedAuction || !bidAmount) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    bidFlow.begin();
    try {
      const bidBn = parseAmount(bidAmount);
      if (bidBn === null) {
        toast.error("Invalid bid", "Bid must be a positive number");
        setTxState("idle");
        bidFlow.close();
        return;
      }
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(bidBn)]);
      if (!enc) throw new Error("Encryption failed");
      bidFlow.submitted();
      const tx = await auctionContract.bid(selectedAuction.id, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      bidFlow.confirmed(tx.hash);
      await tx.wait();
      setTxState("success");
      bidFlow.sealed();
      setBidAmount("");
      setModalView("none");
      setSelectedAuction(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      bidFlow.failed(err);
      handleTxError(err);
    }
  }, [auctionContract, initialized, selectedAuction, bidAmount, encrypt, bidFlow]);

  const handleClose = useCallback(
    (id: number) => guardedAction(`close-${id}`, async () => {
      const tx = await auctionContract!.closeAuction(id);
      setTxState("confirming"); setTxHash(tx.hash); await tx.wait(); setTxState("success");
    }),
    [auctionContract, guardedAction],
  );

  /**
   * Vickrey verifiable reveal flow (audit fix D-VA1).
   *
   * Reads 3 encrypted handles (highestBid, secondBid, highestBidder), fetches
   * Threshold-Network signatures for each via /sdk decryptForTx, then
   * submits revealWinner with all 7 args. Old single-arg call no longer exists
   * on chain — would revert. Same pattern as SealedAuction.
   */
  const handleReveal = useCallback(
    (id: number) => guardedAction(`reveal-${id}`, async () => {
      if (!auctionContract) throw new Error("Auction contract not ready");

      // 1. Read encrypted handles
      const struct = await auctionContract.auctions(id);
      const highBidHandle = struct.highestBid as unknown as string;
      const secondBidHandle = struct.secondBid as unknown as string;
      const bidderHandle = struct.highestBidder as unknown as string;

      // 2. Get TN signatures for all 3 (sequential — TN can be slow)
      setTxState("decrypting");
      const highProof = await decryptForTx(highBidHandle);
      if (!highProof) throw new Error("Highest bid decryption failed");
      const secondProof = await decryptForTx(secondBidHandle);
      if (!secondProof) throw new Error("Second bid decryption failed");
      const bidderProof = await decryptForTx(bidderHandle);
      if (!bidderProof) throw new Error("Bidder decryption failed");

      const bidderAddr = ethers.getAddress(
        "0x" + bidderProof.decryptedValue.toString(16).padStart(40, "0"),
      );

      // 3. Submit reveal with all 7 args + 3 signatures
      setTxState("signing");
      const tx = await auctionContract.revealWinner(
        id,
        highProof.decryptedValue,
        highProof.signature,
        secondProof.decryptedValue,
        secondProof.signature,
        bidderAddr,
        bidderProof.signature,
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setRevealActive(true);

      // 4. Show signature drawer (use second-price proof — that's what winner pays)
      setDrawerProof({
        ctHash: secondBidHandle,
        decryptedValue: `${formatAmount(secondProof.decryptedValue.toString())} (price paid by winner)`,
        signature: secondProof.signature,
        txHash: tx.hash,
        chainId: FHENIX_TESTNET.chainId,
        label: "Vickrey second price",
      });
      setDrawerOpen(true);
    }),
    [auctionContract, guardedAction, decryptForTx],
  );

  const handleSettle = useCallback(
    (id: number) => guardedAction(`settle-${id}`, async () => {
      const tx = await auctionContract!.settleAuction(id);
      setTxState("confirming"); setTxHash(tx.hash); await tx.wait(); setTxState("success");
    }),
    [auctionContract, guardedAction],
  );

  const handleCancel = useCallback(
    (id: number) => guardedAction(`cancel-${id}`, async () => {
      const tx = await auctionContract!.cancelAuction(id);
      setTxState("confirming"); setTxHash(tx.hash); await tx.wait(); setTxState("success");
    }),
    [auctionContract, guardedAction],
  );

  /* ================================================================ */
  /*  Render */
  /* ================================================================ */

  return (
    <div className="space-y-10 max-w-[1180px] mx-auto px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <div className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Vickrey auctions
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Highest bidder wins.{" "}<em className="font-serif italic font-normal">Pays the second price</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Truth-telling becomes the optimal strategy. Bids and clearing logic computed on ciphertext via nested FHE.select.
            </p>
          </div>
        <div className="flex items-center gap-3">
          <FaucetButton />
          {account && (
            <button
              onClick={() => { setModalView("create"); setTxState("idle"); }}
              className="flex items-center gap-2 px-4 py-2 rounded
                         bg-[var(--text)] text-[var(--bg)] text-sm font-medium
                           transition-all"
            >
              <Plus size={16} />
              Create Vickrey
            </button>
          )}
        </div>
      </div></div>
      

      {/* Not connected */}
      {!account && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-10 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded flex items-center justify-center" style={{ background: "var(--text)" }}>
            <Eye size={24} style={{ color: "var(--bg)" }} />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Connect your wallet</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Create and participate in second-price sealed-bid auctions
            with fully encrypted bids.
          </p>
        </div>
      )}

      {/* Not deployed */}
      {account && !deployed && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 border-[var(--border-dash)] flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--text-muted)]">VickreyAuction contract not deployed yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Deploy the contracts and update the address in constants.ts.</p>
          </div>
        </div>
      )}

      {/* Vickrey explanation */}
      {account && (
        <div className="flex items-center gap-3 px-4 py-3 rounded bg-[var(--bg-alt)] border border-[var(--border-dash)]">
          <Info size={16} className="text-[var(--text)] shrink-0" />
          <p className="text-xs text-[var(--text)]/80">
            <strong>Second-price auction:</strong> The highest bidder wins, but pays
            the <em>second-highest</em> bid amount. This incentivizes truthful bidding —
            you always bid your true valuation. All bids are encrypted with FHE until reveal.
          </p>
        </div>
      )}

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />
      <EncryptionProgress stage={stage} visible={encrypting} />

      {/* Reveal animation */}
      {revealActive && selectedAuction && selectedAuction.secondPrice !== "0" && (
        <RevealAnimation
          value={selectedAuction.secondPrice}
          active={revealActive}
          label="Second Price (You Pay)"
          onComplete={() => setTimeout(() => setRevealActive(false), 3000)}
        />
      )}

      {/* Toolbar */}
      {account && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">{auctions.length} auction{auctions.length !== 1 ? "s" : ""}</p>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      )}

      {/* Auction grid */}
      {account && (
        <>
          {loading && auctions.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-[var(--text)] animate-spin" />
            </div>
          ) : auctions.length === 0 ? (
            <EmptyState
              icon={Eye}
              eyebrow="No Vickrey auctions yet"
              title="Run the first second-price auction."
              body="Bidders bid in private, the highest wins, but everyone pays the second-highest price. Incentive-compatible, encrypted, on-chain."
              primary={{ label: "Create Vickrey", onClick: () => { setModalView("create"); setTxState("idle"); } }}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {auctions.map((auction) => {
                const style = STATUS_STYLE[auction.status] ?? STATUS_STYLE[0];
                const mine = isSeller(auction);
                const ended = auction.deadline <= nowSec;

                return (
                  <motion.div
                    key={auction.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="overflow-hidden hover:border-[var(--border-dash)] transition-all"
                  >
                    <div className="px-5 py-4 border-b border-[var(--border-dash)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--text-muted)]">#{auction.id}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}>
                          {STATUS_LABEL[auction.status]}
                        </span>
                      </div>
                      {mine && (
                        <span className="text-[10px] text-[var(--text)] bg-[var(--bg-alt)] px-2 py-0.5 rounded">Your Auction</span>
                      )}
                    </div>

                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Selling</p>
                          <p className="text-lg font-bold text-[var(--text)] break-words">
                            {formatAmount(auction.amount)}{" "}
                            <span className="text-sm font-medium text-[var(--text)]">{tokenSymbol(auction.token)}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--text-muted)]">Payment</p>
                          <p className="text-sm font-medium text-[var(--text-secondary)]">{tokenSymbol(auction.paymentToken)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Timer size={12} className="text-[var(--text)]/60" />
                          <CountdownBadge deadline={auction.deadline} />
                        </div>
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Users size={12} className="text-[var(--text)]/60" />
                          {auction.bidCount} bid{auction.bidCount !== 1 ? "s" : ""}
                        </div>
                      </div>

                      {/* Second price info (after reveal) */}
                      {auction.status >= 2 && auction.winner !== "0x0000000000000000000000000000000000000000" && (
                        <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-3 py-2 space-y-1">
                          <p className="text-[10px] text-[var(--text)]/60 uppercase tracking-wider font-semibold">
                            Winner pays 2nd price
                          </p>
                          <p className="text-xs text-[var(--text-secondary)] font-mono">{shortAddr(auction.winner)}</p>
                          <p className="text-sm text-[var(--text)] font-semibold break-words">
                            Pays: {formatAmount(auction.secondPrice)} (2nd highest)
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="px-5 py-3 border-t border-[var(--border-dash)] flex items-center gap-2">
                      {auction.status === 0 && !ended && !mine && (
                        <button
                          onClick={() => { setSelectedAuction(auction); setBidAmount(""); setModalView("bid"); setTxState("idle"); }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--text)] text-[var(--bg)] transition-all"
                        >
                          <Lock size={12} /> Place Bid
                        </button>
                      )}
                      {auction.status === 0 && mine && ended && auction.bidCount > 0 && (
                        <button onClick={() => handleClose(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-all">
                          <Clock size={12} /> Close
                        </button>
                      )}
                      {auction.status === 0 && mine && auction.bidCount === 0 && (
                        <button onClick={() => handleCancel(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-all">
                          <X size={12} /> Cancel
                        </button>
                      )}
                      {auction.status === 1 && (
                        <button onClick={() => { setSelectedAuction(auction); handleReveal(auction.id); }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all">
                          <Zap size={12} /> Reveal Winner
                        </button>
                      )}
                      {auction.status === 2 && (
                        <button onClick={() => handleSettle(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all">
                          <CheckCircle2 size={12} /> Settle
                        </button>
                      )}
                      <button
                        onClick={() => { setSelectedAuction(auction); setModalView("detail"); setTxState("idle"); }}
                        className="rounded px-3 py-2 text-xs font-medium bg-bgCard border border-[var(--border-dash)] text-[var(--text-muted)]
                                   hover:text-[var(--text)] hover:bg-bgCard transition-all">
                        Details
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ======================== CREATE MODAL ======================== */}
      <AnimatePresence>
        {modalView === "create" && (
          <motion.div key="create-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}>
            <motion.div key="create-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-lg p-6 space-y-5  max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Eye size={18} className="text-[var(--text)]" /> Create Vickrey Auction
                </h3>
                <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Token selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Token to Auction</label>
                <select value={cToken} onChange={(e) => setCToken(e.target.value)}
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--border-dash)] transition-colors">
                  {TOKEN_OPTIONS.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Payment Token</label>
                <select value={cPayToken} onChange={(e) => setCPayToken(e.target.value)}
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--border-dash)] transition-colors">
                  <option value="">Select token</option>
                  {TOKEN_OPTIONS.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Amount</label>
                <input type="number" value={cAmount} onChange={(e) => setCAmount(e.target.value)} placeholder="0" min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-dash)] transition-colors" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTS.map((d) => (
                    <button key={d.value} type="button" onClick={() => setCDuration(d.value)}
                      className={`rounded px-3 py-2 text-xs font-medium border transition-all ${
                        cDuration === d.value
                          ? "bg-[var(--bg-alt)] border-[var(--border-dash)] text-[var(--text)]"
                          : "bg-[var(--bg)] border-[var(--border-dash)] text-[var(--text-muted)] hover:border-[var(--border-dash)]"
                      }`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleCreate}
                disabled={txState === "signing" || txState === "confirming" || !cAmount || !cPayToken}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-[var(--text)] text-[var(--bg)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {txState === "signing" || txState === "confirming" ? (
                  <><Loader2 size={16} className="animate-spin" /> Processing...</>
                ) : (
                  <><Plus size={16} /> Create Vickrey Auction</>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== BID MODAL ======================== */}
      <AnimatePresence>
        {modalView === "bid" && selectedAuction && (
          <motion.div key="bid-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}>
            <motion.div key="bid-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-6 space-y-5 ">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Lock size={18} className="text-[var(--text)]" /> Place Sealed Bid
                </h3>
                <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3 space-y-1">
                <p className="text-xs text-[var(--text-muted)]">Auction #{selectedAuction.id}</p>
                <p className="text-sm font-semibold text-[var(--text)] break-words">
                  {formatAmount(selectedAuction.amount)} {tokenSymbol(selectedAuction.token)}
                </p>
              </div>

              <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3">
                <p className="text-xs text-[var(--text)]/80">
                  <strong>Vickrey rule:</strong> Bid your true valuation. If you win, you pay the
                  second-highest bid, not yours. Overbidding has no extra cost.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Your Bid Amount</label>
                <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} placeholder="0" min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-dash)] transition-colors" />
              </div>

              <button onClick={handleBid}
                disabled={txState === "signing" || txState === "confirming" || encrypting || !bidAmount}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-[var(--text)] text-[var(--bg)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {encrypting ? (
                  <><Loader2 size={16} className="animate-spin" /> Encrypting bid...</>
                ) : txState === "signing" || txState === "confirming" ? (
                  <><Loader2 size={16} className="animate-spin" /> Processing...</>
                ) : (
                  <><Lock size={16} /> Submit Encrypted Bid</>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Verifiable reveal proof drawer */}
      <SignatureDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={drawerProof}
      />

      <TxFlowDrawer
        open={bidFlow.step !== "idle"}
        step={bidFlow.step}
        subjectNoun="bid"
        title={bidFlow.step === "sealed" ? "Your bid is sealed" : "Submitting your encrypted bid"}
        txHash={bidFlow.txHash}
        chainId={FHENIX_TESTNET.chainId}
        errorMessage={bidFlow.errorMessage}
        onClose={bidFlow.close}
        onRetry={() => { bidFlow.close(); void handleBid(); }}
      />
    </div>
  );
}
