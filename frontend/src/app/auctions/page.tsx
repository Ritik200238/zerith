"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Gavel,
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
  Eye,
  ShieldCheck,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { EncryptionProgress } from "@/components/shared/EncryptionProgress";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import {
  SignatureDrawer,
  type SignatureProof,
} from "@/components/shared/SignatureDrawer";
import { PrivacyReportCard } from "@/components/shared/PrivacyReportCard";
import { PrivacyLens } from "@/components/shared/PrivacyLens";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";
import { ethers } from "ethers";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { formatAmount, parseAmount, isValidAddress, shortAddress as shortAddrUtil } from "@/lib/format";
import { useTxFeedback } from "@/hooks/useTxFeedback";

/* ------------------------------------------------------------------ */
/*  Types */
/* ------------------------------------------------------------------ */

interface AuctionData {
  id: number;
  seller: string;
  token: string;
  paymentToken: string;
  amount: string;
  deadline: number;
  bidCount: number;
  status: number; // 0=OPEN 1=CLOSED 2=REVEALED 3=SETTLED 4=CANCELLED 5=RESERVE_NOT_MET
  revealedBid: string;
  revealedBidder: string;
  myBidUnsealed: string | null;
  // Blind Floor extensions
  hasReserve: boolean;
  revealedReserveMet: boolean;
}

type ModalView = "none" | "create" | "bid" | "detail";

/* ------------------------------------------------------------------ */
/*  Constants */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<number, string> = {
  0: "OPEN",
  1: "CLOSED",
  2: "REVEALED",
  3: "SETTLED",
  4: "CANCELLED",
  5: "RESERVE NOT MET",
};

const STATUS_STYLE: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  3: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]", border: "border-borderDash" },
  4: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
  5: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
};

const DURATION_OPTS = [
  { label: "5 min",  value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
  { label: "24 hrs", value: 86400 },
];

const SNIPE_OPTS = [
  { label: "30 s",  value: 30 },
  { label: "60 s",  value: 60 },
  { label: "120 s", value: 120 },
];

const TOKEN_OPTIONS = [
  { label: "CDEX", address: CONTRACTS.ConfidentialToken, symbol: "CDEX" },
  { label: "MOCK", address: CONTRACTS.MockToken, symbol: "MOCK" },
];

/* ------------------------------------------------------------------ */
/*  Helpers */
/* ------------------------------------------------------------------ */

function tokenSymbol(addr: string): string {
  const hit = TOKEN_OPTIONS.find((t) => t.address.toLowerCase() === addr.toLowerCase());
  return hit ? hit.symbol : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  Countdown hook (ticks every second) */
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
    <span
      className={`font-mono text-xs ${
        ended ? "text-[var(--text-muted)]" : urgent ? "text-[var(--text-muted)] animate-pulse" : "text-[var(--text)]"
      }`}
    >
      {str}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Token dropdown (reusable) */
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
          <ChevronDown
            size={14}
            className={`text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute z-50 mt-1 w-full rounded border border-[var(--border-dash)]
                         bg-[var(--bg-card)]  overflow-hidden"
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
/*  AuctionsPage */
/* ================================================================== */

export default function AuctionsPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const { decrypt: decryptForTx } = useDecryptForTx();
  const toast = useToast();
  const auctionContract = useContract("SealedAuction");
  const auctionRead = useReadContract("SealedAuction");

  /* ---- core state ---- */
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  /* ---- modals ---- */
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedAuction, setSelectedAuction] = useState<AuctionData | null>(null);

  // Audit fix F4: Escape key + body scroll lock + ARIA dialog role for all modals
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));

  /* ---- create-auction form ---- */
  const [cToken, setCToken] = useState<string>(CONTRACTS.ConfidentialToken);
  const [cPayToken, setCPayToken] = useState<string>("");
  const [cAmount, setCAmount] = useState("");
  const [cDuration, setCDuration] = useState(3600);
  const [cSnipe, setCSnipe] = useState(120);
  /* Blind Floor: when on, seller's reserve price is encrypted and NEVER decrypted */
  const [cBlindFloor, setCBlindFloor] = useState(false);
  const [cReserve, setCReserve] = useState("");

  /* ---- bid form ---- */
  const [bidAmount, setBidAmount] = useState("");

  /* ---- tx feedback ---- */
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Sealed Auction", type: "auction", href: "/auctions", txHash });

  /* ---- signature drawer (verifiable reveal proof) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProof, setDrawerProof] = useState<SignatureProof | null>(null);

  const busyRef = useRef<Set<string>>(new Set());

  const deployed =
    CONTRACTS.SealedAuction !== "0x0000000000000000000000000000000000000000";

  const nowSec = Math.floor(Date.now() / 1000);

  const isSeller = (a: AuctionData) =>
    account !== null && a.seller.toLowerCase() === account.toLowerCase();

  /* ---------------------------------------------------------------- */
  /*  Fetch all auctions from chain */
  /* ---------------------------------------------------------------- */

  const fetchAuctions = useCallback(async () => {
    if (!auctionRead) return;
    setLoading(true);
    try {
      const total = Number(await auctionRead.getAuctionCount());
      const list: AuctionData[] = [];

      for (let i = 0; i < total; i++) {
        const a = await auctionRead.getAuction(i);
        // Blind Floor metadata — separate getter (new contract API)
        let hasReserve = false;
        let revealedReserveMet = false;
        try {
          const blind = await auctionRead.getBlindStatus(i);
          hasReserve = blind[0];
          revealedReserveMet = blind[1];
        } catch {
          /* contract may be pre-Blind-Floor or call may fail; treat as standard */
        }
        list.push({
          id: i,
          seller: a[0],
          token: a[1],
          paymentToken: a[2],
          amount: a[3].toString(),
          deadline: Number(a[4]),
          bidCount: Number(a[5]),
          status: Number(a[6]),
          revealedBid: a[7].toString(),
          revealedBidder: a[8],
          myBidUnsealed:  null,
          hasReserve,
          revealedReserveMet,
        });
      }

      list.reverse(); // newest first
      setAuctions(list);
    } catch {
      setAuctions([]);
    } finally {
      setLoading(false);
    }
  }, [auctionRead]);

  // Audit fix E3: poll new blocks so multi-user updates appear without refresh
  const blockTick = useBlockPoll();
  useEffect(() => { fetchAuctions(); }, [fetchAuctions, refreshKey, blockTick]);

  // Audit fix E1: clear cross-account state when user switches wallets
  useAccountChangeReset(useCallback(() => {
    setAuctions((prev) => prev.map((a) => ({ ...a, myBidUnsealed: null })));
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /*  Tx helper (reduces boilerplate) */
  /* ---------------------------------------------------------------- */

  function handleTxError(err: unknown) {
    const isRejection =
      err instanceof Error && err.message.includes("user rejected");
    const message = isRejection
      ? "You rejected the transaction in your wallet"
      : err instanceof Error
        ? err.message.slice(0, 200)
        : "Transaction failed";
    setTxState("error");
    setTxError(message);
    // Audit fix F7: replace silent inline-only errors with persistent toast
    toast.error(isRejection ? "Transaction cancelled" : "Transaction failed", message);
  }

  /* ---------------------------------------------------------------- */
  /*  Unseal own bid */
  /* ---------------------------------------------------------------- */

  const unsealMyBid = useCallback(
    async (auction: AuctionData) => {
      if (!auctionContract || !account) return;
      try {
        const hash = await auctionContract.getMyBid(auction.id);
        const val  = await unseal(BigInt(hash), 5); // Uint128
        if (val !== null) {
          setAuctions((prev) =>
            prev.map((a) =>
              a.id === auction.id ? { ...a, myBidUnsealed: val.toString() } : a,
            ),
          );
          // Also update selectedAuction if open
          setSelectedAuction((prev) =>
            prev && prev.id === auction.id
              ? { ...prev, myBidUnsealed: val.toString() }
              : prev,
          );
        }
      } catch {
        /* no bid placed or unseal failed — expected */
      }
    },
    [auctionContract, account, unseal],
  );

  /* ---------------------------------------------------------------- */
  /*  Create auction */
  /* ---------------------------------------------------------------- */

  const handleCreate = useCallback(async () => {
    if (!auctionContract || !cToken || !cPayToken || !cAmount) return;
    if (cBlindFloor && !cReserve) {
      toast.warning("Reserve required", "Blind Floor auctions need an encrypted reserve price.");
      return;
    }
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      let tx;
      if (cBlindFloor) {
        // Encrypt the reserve client-side; the value NEVER decrypts on-chain.
        const { Encryptable } = await import("@cofhe/sdk");
        const enc = await encrypt([Encryptable.uint128(BigInt(cReserve))]);
        if (!enc) throw new Error("Reserve encryption failed");
        tx = await auctionContract.createBlindAuction(
          cToken,
          cPayToken,
          BigInt(cAmount),
          BigInt(cDuration),
          BigInt(cSnipe),
          enc[0],
        );
      } else {
        tx = await auctionContract.createAuction(
          cToken,
          cPayToken,
          BigInt(cAmount),
          BigInt(cDuration),
          BigInt(cSnipe),
        );
      }
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      toast.success(
        cBlindFloor ? "Blind Floor auction created" : "Auction created",
        cBlindFloor
          ? "Reserve price is sealed forever — bidders can't reverse-engineer it."
          : "Sealed-bid auction is live.",
      );
      setCAmount("");
      setCReserve("");
      setCBlindFloor(false);
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [auctionContract, cToken, cPayToken, cAmount, cDuration, cSnipe, cBlindFloor, cReserve, encrypt, toast]);

  /* ---------------------------------------------------------------- */
  /*  Place bid */
  /* ---------------------------------------------------------------- */

  const handleBid = useCallback(async () => {
    if (!auctionContract || !initialized || !selectedAuction || !bidAmount) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(BigInt(bidAmount))]);
      if (!enc) throw new Error("Encryption failed");

      const tx = await auctionContract.bid(selectedAuction.id, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setBidAmount("");
      setModalView("none");
      setSelectedAuction(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [auctionContract, initialized, selectedAuction, bidAmount, encrypt]);

  /* ---- single-use action helpers (close / reveal / settle / cancel) */

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

  const handleClose = useCallback(
    (id: number) =>
      guardedAction(`close-${id}`, async () => {
        const tx = await auctionContract!.closeAuction(id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [auctionContract, guardedAction],
  );

  /**
   * Verifiable reveal — Wave 3 W3.1 flow.
   *
   * 1. Read encrypted handles (highestBid + highestBidder) from contract.
   * 2. Ask Threshold Network for {value, signature} via decryptForTx.
   * 3. Submit revealWinner with verified values + TN signatures.
   * 4. Open SignatureDrawer with the proof.
   *
   * The contract checks each signature via FHE.publishDecryptResult.
   * Anyone can submit — not just the seller — because FHE.allowGlobal
   * marked the handles as publicly decryptable when closeAuction was called.
   */
  const handleReveal = useCallback(
    (id: number) =>
      guardedAction(`reveal-${id}`, async () => {
        if (!auctionContract) throw new Error("Auction contract not ready");

        // 1. Read encrypted handles via the public mapping getter
        const struct = await auctionContract.auctions(id);
        const bidHandle = struct.highestBid as unknown as string;
        const bidderHandle = struct.highestBidder as unknown as string;
        const hasReserve = Boolean(struct.hasReserve);
        const reserveMetHandle = struct.encReserveMet as unknown as string;

        // 2. Get verifiable plaintext + signatures from Threshold Network
        setTxState("decrypting");
        const bidProof = await decryptForTx(bidHandle);
        if (!bidProof) throw new Error("Bid decryption failed");
        const bidderProof = await decryptForTx(bidderHandle);
        if (!bidderProof) throw new Error("Bidder decryption failed");
        // Blind Floor: also fetch the reserveMet boolean proof (sealed reserve outcome)
        let reserveMetProof: Awaited<ReturnType<typeof decryptForTx>> | null = null;
        if (hasReserve) {
          reserveMetProof = await decryptForTx(reserveMetHandle);
          if (!reserveMetProof) throw new Error("Reserve outcome decryption failed");
        }

        // Format bidder bigint -> 20-byte address string
        const bidderAddr = ethers.getAddress(
          "0x" + bidderProof.decryptedValue.toString(16).padStart(40, "0"),
        );

        // 3. Submit reveal with verified values + signatures
        setTxState("signing");
        const tx = hasReserve
          ? await auctionContract.revealWinnerBlind(
              id,
              bidProof.decryptedValue,
              bidProof.signature,
              bidderAddr,
              bidderProof.signature,
              reserveMetProof!.decryptedValue,
              reserveMetProof!.signature,
            )
          : await auctionContract.revealWinner(
              id,
              bidProof.decryptedValue,
              bidProof.signature,
              bidderAddr,
              bidderProof.signature,
            );
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");

        // 4. Show signature drawer (uses bid proof — most informative)
        setDrawerProof({
          ctHash: bidHandle,
          decryptedValue: `${formatAmount(bidProof.decryptedValue)} (winning bid)`,
          signature: bidProof.signature,
          txHash: tx.hash,
          chainId: FHENIX_TESTNET.chainId,
          label: "Winning bid value",
        });
        setDrawerOpen(true);

        const reserveMet = hasReserve ? reserveMetProof!.decryptedValue === BigInt(1) : true;
        toast.success(
          hasReserve
            ? reserveMet
              ? "Reserve MET — auction reveal verified"
              : "Reserve NOT MET — auction closes, reserve stays sealed"
            : "Auction reveal verified",
          `Winner: ${shortAddrUtil(bidderAddr)} · Bid: ${formatAmount(bidProof.decryptedValue)}`,
          {
            href: `${FHENIX_TESTNET.blockExplorer}/tx/${tx.hash}`,
            hrefLabel: "View on Etherscan",
          },
        );
      }),
    [auctionContract, guardedAction, decryptForTx, toast],
  );

  const handleSettle = useCallback(
    (id: number) =>
      guardedAction(`settle-${id}`, async () => {
        const tx = await auctionContract!.settleAuction(id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [auctionContract, guardedAction],
  );

  const handleCancel = useCallback(
    (id: number) =>
      guardedAction(`cancel-${id}`, async () => {
        const tx = await auctionContract!.cancelAuction(id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [auctionContract, guardedAction],
  );

  /* ================================================================ */
  /*  Render */
  /* ================================================================ */

  return (
    <div
      className="space-y-10 max-w-[1180px] mx-auto px-5 md:px-10 py-12 md:py-16 font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* ---------- header ---------- */}
      <div className="space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Sealed-bid auctions
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Highest wins.{" "}
              <em className="font-serif italic font-normal">Losers learn nothing</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Bids encrypted on submission. Compared on ciphertext. Only the winning
              amount and bidder ever decrypted on chain.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <FaucetButton />
            {account && (
              <button
                onClick={() => {
                  setModalView("create");
                  setTxState("idle");
                }}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
              >
                <Plus size={14} /> Create Auction
              </button>
            )}
          </div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

      {/* ---------- privacy report card ---------- */}
      <PrivacyReportCard
        feature="Sealed-Bid Auctions"
        contractAddress={CONTRACTS.SealedAuction}
        explorerUrl={FHENIX_TESTNET.blockExplorer}
        report={{
          encrypted: [
            "Every bid amount (euint128)",
            "Bidder identity until reveal (eaddress)",
            "Highest bid + bidder tracked entirely on ciphertext",
            "Losing bids — never decrypted, ever",
          ],
          visible: [
            "Number of bids placed (count only, no amounts)",
            "Auction deadline + anti-snipe extensions",
            "Token being auctioned + payment token",
          ],
          leaks: [],
          fheOps: [
            "asEuint128",
            "asEaddress",
            "gt",
            "max",
            "select",
            "allowThis",
            "allow",
            "allowGlobal",
            "publishDecryptResult",
          ],
        }}
      />

      {/* ---------- privacy lens — driven by Navbar mode toggle ---------- */}
      {(() => {
        const sample = auctions[0];
        const isBlind = sample?.hasReserve ?? false;
        return (
          <div className="my-6">
            <div
              className="font-mono text-[11px] uppercase tracking-[0.1em] mb-3"
              style={{ color: "var(--text-muted)" }}
            >
              — Privacy lens · sample {isBlind ? "Blind Floor" : "sealed-bid"} auction
            </div>
            <PrivacyLens
              title="What each role sees about a sealed auction"
              rows={[
                {
                  label: "Auctioned token + amount",
                  meValue: sample ? `${sample.amount} ${tokenSymbol(sample.token)}` : "1000 CDEX",
                  counterpartyValue: sample ? `${sample.amount} ${tokenSymbol(sample.token)}` : "1000 CDEX",
                  observerValue: sample ? `${sample.amount} ${tokenSymbol(sample.token)}` : "1000 CDEX",
                  encrypted: false,
                },
                {
                  label: "Your bid amount",
                  meValue: sample?.myBidUnsealed
                    ? `${sample.myBidUnsealed} ${tokenSymbol(sample.paymentToken)}`
                    : "Unseal your bid to view",
                  counterpartyValue: "🔒 sealed (other bidders never see your bid)",
                  observerValue: "🔒 sealed (only the winning amount is published)",
                  encrypted: true,
                },
                {
                  label: "Other bidders' amounts",
                  meValue: "🔒 sealed (never revealed)",
                  counterpartyValue: "🔒 sealed (their own bid only)",
                  observerValue: "🔒 sealed (losing bids never decrypt — ever)",
                  encrypted: true,
                },
                ...(isBlind
                  ? [
                      {
                        label: "Reserve price",
                        meValue: "🔒 sealed (seller never decrypts it on-chain either)",
                        counterpartyValue: "🔒 sealed",
                        observerValue: "🔒 sealed — ONLY the ≥/< boolean outcome is revealed",
                        encrypted: true,
                      },
                    ]
                  : []),
                {
                  label: "Winner + price (after reveal)",
                  meValue: sample?.revealedBidder && sample.revealedBidder !== "0x0000000000000000000000000000000000000000"
                    ? `${sample.revealedBidder.slice(0, 6)}… · ${sample.revealedBid}`
                    : "Pending reveal",
                  counterpartyValue: sample?.revealedBidder && sample.revealedBidder !== "0x0000000000000000000000000000000000000000"
                    ? `${sample.revealedBidder.slice(0, 6)}… · ${sample.revealedBid}`
                    : "Pending reveal",
                  observerValue: sample?.revealedBidder && sample.revealedBidder !== "0x0000000000000000000000000000000000000000"
                    ? `${sample.revealedBidder.slice(0, 6)}… · ${sample.revealedBid}`
                    : "Pending reveal",
                  encrypted: false,
                },
              ]}
            />
          </div>
        );
      })()}

      {/* ---------- not connected ---------- */}
      {!account && (
        <div
          className="p-10 text-center space-y-4"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
          }}
        >
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Wallet required
          </div>
          <h2 className="font-display text-2xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
            Connect your wallet
          </h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto" }}>
            Create auctions, place sealed bids, and discover winners — all with
            fully encrypted bid amounts via FHE.
          </p>
        </div>
      )}

      {/* ---------- contract not deployed ---------- */}
      {account && !deployed && (
        <div
          className="p-5 flex items-start gap-3"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
          }}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              SealedAuction contract not deployed yet
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Deploy the contracts and update the address in constants.ts.
            </p>
          </div>
        </div>
      )}

      {/* ---------- anti-snipe info ---------- */}
      {account && (
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
          }}
        >
          <Timer size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            <span
              className="font-mono uppercase tracking-[0.1em] mr-2"
              style={{ color: "var(--text)" }}
            >
              Anti-snipe:
            </span>
            Bids in the last 60 seconds extend the deadline. Bid amounts stay
            encrypted — snipers cannot see what to outbid.
          </p>
        </div>
      )}

      {/* ---------- tx / encryption status ---------- */}
      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />
      <EncryptionProgress stage={stage} visible={encrypting} />

      {/* ---------- toolbar ---------- */}
      {account && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">
            {auctions.length} auction{auctions.length !== 1 ? "s" : ""}
          </p>
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

      {/* ================= AUCTION GRID ================= */}
      {account && (
        <>
          {loading && auctions.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-[var(--text)] animate-spin" />
            </div>
          ) : auctions.length === 0 ? (
            <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="py-20 text-center space-y-3">
              <Gavel size={36} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">No auctions yet</p>
              <p className="text-xs text-[var(--text-muted)]">
                Create the first sealed-bid auction to get started
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {auctions.map((auction) => {
                const style = STATUS_STYLE[auction.status] ?? STATUS_STYLE[0];
                const mine  = isSeller(auction);
                const ended = auction.deadline <= nowSec;

                return (
                  <motion.div
                    key={auction.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="overflow-hidden hover:border-[var(--border-dash)] transition-all"
                  >
                    {/* ---- card header ---- */}
                    <div className="px-5 py-4 border-b border-[var(--border-dash)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--text-muted)]">#{auction.id}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
                        >
                          {STATUS_LABEL[auction.status]}
                        </span>
                        {auction.hasReserve && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                            style={{ border: "1px dashed var(--border-dash)", color: "var(--accent-2)" }}
                            title="Encrypted reserve price — never decrypts on-chain"
                          >
                            <Lock size={9} />
                            BLIND FLOOR
                          </span>
                        )}
                      </div>
                      {mine && (
                        <span className="text-[10px] text-[var(--text)] bg-[var(--bg-alt)] px-2 py-0.5 rounded">
                          Your Auction
                        </span>
                      )}
                    </div>

                    {/* ---- card body ---- */}
                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Selling</p>
                          <p className="text-lg font-bold text-[var(--text)]">
                            {auction.amount}{" "}
                            <span className="text-sm font-medium text-[var(--text)]">
                              {tokenSymbol(auction.token)}
                            </span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--text-muted)]">Payment</p>
                          <p className="text-sm font-medium text-[var(--text-secondary)]">
                            {tokenSymbol(auction.paymentToken)}
                          </p>
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

                      {auction.status === 0 && !ended && (
                        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                          <Shield size={10} className="text-[var(--text)]/40" />
                          Anti-snipe protection active
                        </div>
                      )}

                      {/* winner (after reveal) */}
                      {auction.status >= 2 &&
                        auction.revealedBidder !==
                          "0x0000000000000000000000000000000000000000" && (
                          <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-3 py-2 space-y-1">
                            <p className="text-[10px] text-[var(--text)]/60 uppercase tracking-wider font-semibold">
                              Winner
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] font-mono">
                              {shortAddr(auction.revealedBidder)}
                            </p>
                            <p className="text-sm text-[var(--text)] font-semibold">
                              Bid: {auction.revealedBid}
                            </p>
                          </div>
                        )}
                    </div>

                    {/* ---- card actions ---- */}
                    <div className="px-5 py-3 border-t border-[var(--border-dash)] flex items-center gap-2">
                      {/* OPEN + not seller + not ended => Place Bid */}
                      {auction.status === 0 && !ended && !mine && (
                        <button
                          onClick={() => {
                            setSelectedAuction(auction);
                            setBidAmount("");
                            setModalView("bid");
                            setTxState("idle");
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--text)] text-[var(--bg)]
                                       transition-all"
                        >
                          <Lock size={12} />
                          Place Bid
                        </button>
                      )}

                      {/* OPEN + seller + ended + bids => Close */}
                      {auction.status === 0 && mine && ended && auction.bidCount > 0 && (
                        <button
                          onClick={() => handleClose(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)]
                                     hover:bg-[var(--bg-alt)] transition-all"
                        >
                          <Clock size={12} />
                          Close Auction
                        </button>
                      )}

                      {/* OPEN + seller + no bids => Cancel */}
                      {auction.status === 0 && mine && auction.bidCount === 0 && (
                        <button
                          onClick={() => handleCancel(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)]
                                     hover:bg-[var(--bg-alt)] transition-all"
                        >
                          <X size={12} />
                          Cancel
                        </button>
                      )}

                      {/* CLOSED => Reveal Verified (Threshold Network signed) */}
                      {auction.status === 1 && (
                        <button
                          onClick={() => handleReveal(auction.id)}
                          disabled={txState === "decrypting" || txState === "signing"}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)]
                                     hover:bg-[var(--bg-alt)] transition-all
                                     disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Reveals winner with cryptographic proof from Fhenix Threshold Network"
                        >
                          <ShieldCheck size={12} />
                          Reveal Verified
                        </button>
                      )}

                      {/* REVEALED => Settle */}
                      {auction.status === 2 && (
                        <button
                          onClick={() => handleSettle(auction.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)]
                                     hover:bg-[var(--bg-alt)] transition-all"
                        >
                          <CheckCircle2 size={12} />
                          Settle
                        </button>
                      )}

                      {/* Details (always) */}
                      <button
                        onClick={() => {
                          setSelectedAuction(auction);
                          setModalView("detail");
                          setTxState("idle");
                        }}
                        className="rounded px-3 py-2 text-xs font-medium
                                   bg-bgCard border border-[var(--border-dash)] text-[var(--text-muted)]
                                   hover:text-[var(--text)] hover:bg-bgCard transition-all"
                      >
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

      {/* ======================== CREATE AUCTION MODAL ======================== */}
      <AnimatePresence>
        {modalView === "create" && (
          <motion.div
            key="create-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")}
            {...modalProps}
          >
            <motion.div
              key="create-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-lg p-6 space-y-5
                          max-h-[90vh] overflow-y-auto"
            >
              {/* header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Gavel size={18} className="text-[var(--text)]" />
                  Create Auction
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <TokenDropdown label="Token to Auction" value={cToken} onChange={setCToken} />
              <TokenDropdown label="Payment Token" value={cPayToken} onChange={setCPayToken} />

              {/* amount */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Amount</label>
                <input
                  type="number"
                  value={cAmount}
                  onChange={(e) => setCAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              {/* duration */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setCDuration(d.value)}
                      className={`rounded px-3 py-2 text-xs font-medium border transition-all ${
                        cDuration === d.value
                          ? "bg-[var(--bg-alt)] border-[var(--border-dash)] text-[var(--text)]"
                          : "bg-[var(--bg)] border-[var(--border-dash)] text-[var(--text-muted)] hover:border-[var(--border-dash)]"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* snipe extension */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                  <Shield size={10} className="text-[var(--text)]" />
                  Anti-Snipe Extension
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {SNIPE_OPTS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setCSnipe(s.value)}
                      className={`rounded px-3 py-2 text-xs font-medium border transition-all ${
                        cSnipe === s.value
                          ? "bg-[var(--bg-alt)] border-[var(--border-dash)] text-[var(--text)]"
                          : "bg-[var(--bg)] border-[var(--border-dash)] text-[var(--text-muted)] hover:border-[var(--border-dash)]"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Bids in the last 60 s extend the deadline by this amount
                </p>
              </div>

              {/* Blind Floor toggle — the headline innovation */}
              <div className="space-y-2 pt-2" style={{ borderTop: "1px dashed var(--border-dash)" }}>
                <label className="flex items-start gap-2 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={cBlindFloor}
                    onChange={(e) => setCBlindFloor(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-[var(--text)] font-semibold">
                      Blind Floor Auction
                    </span>
                    <span className="block text-[11px] text-[var(--text-muted)] leading-snug">
                      Set an encrypted reserve price that <em>never decrypts</em>. Bidders can't
                      reverse-engineer the floor — they must bid their true value.
                    </span>
                  </span>
                </label>

                {cBlindFloor && (
                  <div className="space-y-1.5 pl-6">
                    <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">
                      Encrypted Reserve Price
                    </label>
                    <input
                      type="number"
                      value={cReserve}
                      onChange={(e) => setCReserve(e.target.value)}
                      placeholder="e.g. 10000"
                      min="1"
                      className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-dashed border-[var(--border-dash)]
                                 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                                 focus:outline-none focus:border-[var(--text)] transition-colors"
                    />
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Encrypted client-side. Stored on-chain as ciphertext.
                      Contract reveals only "≥ reserve / &lt; reserve" — never the reserve itself.
                    </p>
                  </div>
                )}
              </div>

              {/* submit */}
              <button
                onClick={handleCreate}
                disabled={
                  !cToken ||
                  !cPayToken ||
                  !cAmount ||
                  (cBlindFloor && !cReserve) ||
                  txState === "signing" ||
                  txState === "confirming"
                }
                className="w-full rounded py-3 text-sm font-semibold text-[var(--bg)]
                           bg-[var(--text)]
                            
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-all flex items-center justify-center gap-2"
              >
                {txState === "signing" ? (
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
                    <Gavel size={14} />
                    {cBlindFloor ? "Create Blind Floor Auction" : "Create Auction"}
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== BID MODAL ======================== */}
      <AnimatePresence>
        {modalView === "bid" && selectedAuction && (
          <motion.div
            key="bid-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => {
              setModalView("none");
              setSelectedAuction(null);
            }}
          >
            <motion.div
              key="bid-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-6 space-y-5 "
            >
              {/* header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Lock size={18} className="text-[var(--text)]" />
                  Place Sealed Bid
                </h3>
                <button
                  onClick={() => {
                    setModalView("none");
                    setSelectedAuction(null);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* auction info */}
              <div className="space-y-2.5 rounded bg-[var(--bg)]/80 p-4 border border-[var(--border-dash)]">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Auction</span>
                  <span className="text-[var(--text)] font-mono">#{selectedAuction.id}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Selling</span>
                  <span className="text-[var(--text)] font-medium">
                    {selectedAuction.amount} {tokenSymbol(selectedAuction.token)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Payment Token</span>
                  <span className="text-[var(--text)]">{tokenSymbol(selectedAuction.paymentToken)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Time Left</span>
                  <CountdownBadge deadline={selectedAuction.deadline} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Bids</span>
                  <span className="text-[var(--text)]">{selectedAuction.bidCount}</span>
                </div>
              </div>

              {/* bid input */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                  <Lock size={10} className="text-[var(--text)]" />
                  Your Bid Amount
                </label>
                <input
                  type="number"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder="Enter bid amount"
                  min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              {/* privacy note */}
              <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3">
                <p className="text-xs text-[var(--text)]/80 leading-relaxed">
                  Your bid is encrypted — nobody sees it until the auction
                  closes. The highest bid wins, discovered via FHE.gt() and
                  FHE.max() without revealing losing bids.
                </p>
              </div>

              {/* encryption progress */}
              <EncryptionProgress stage={stage} visible={encrypting} />

              {/* submit */}
              <button
                onClick={handleBid}
                disabled={
                  !initialized ||
                  !bidAmount ||
                  encrypting ||
                  txState === "signing" ||
                  txState === "confirming"
                }
                className="w-full rounded py-3 text-sm font-semibold text-[var(--bg)]
                           bg-[var(--text)]
                            
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-all flex items-center justify-center gap-2"
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
                    Encrypt &amp; Submit Bid
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== DETAIL MODAL ======================== */}
      <AnimatePresence>
        {modalView === "detail" && selectedAuction && (
          <motion.div
            key="detail-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => {
              setModalView("none");
              setSelectedAuction(null);
            }}
          >
            <motion.div
              key="detail-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-lg p-6 space-y-5
                          max-h-[90vh] overflow-y-auto"
            >
              {/* header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)]">
                  Auction #{selectedAuction.id}
                </h3>
                <button
                  onClick={() => {
                    setModalView("none");
                    setSelectedAuction(null);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* status */}
              {(() => {
                const s = STATUS_STYLE[selectedAuction.status] ?? STATUS_STYLE[0];
                return (
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded text-xs font-bold uppercase tracking-wider border ${s.bg} ${s.text} ${s.border}`}
                  >
                    {STATUS_LABEL[selectedAuction.status]}
                  </span>
                );
              })()}

              {/* countdown */}
              <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Timer size={14} className="text-[var(--text)]" />
                  <span className="uppercase tracking-wider font-semibold">Timer</span>
                </div>
                <div className="text-2xl font-bold text-[var(--text)]">
                  <CountdownBadge deadline={selectedAuction.deadline} />
                </div>
                {selectedAuction.status === 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                    <Shield size={10} className="text-[var(--text)]/40" />
                    Anti-snipe: late bids extend the deadline
                  </div>
                )}
              </div>

              {/* details */}
              <div className="space-y-2.5 rounded bg-[var(--bg)]/80 p-4 border border-[var(--border-dash)]">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Seller</span>
                  <span className="font-mono text-[var(--text-secondary)] text-xs">
                    {shortAddr(selectedAuction.seller)}
                    {isSeller(selectedAuction) && (
                      <span className="ml-2 text-[var(--text)]">(you)</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Selling</span>
                  <span className="text-[var(--text)] font-medium">
                    {selectedAuction.amount} {tokenSymbol(selectedAuction.token)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Payment Token</span>
                  <span className="text-[var(--text)]">{tokenSymbol(selectedAuction.paymentToken)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Total Bids</span>
                  <span className="text-[var(--text)]">{selectedAuction.bidCount}</span>
                </div>
              </div>

              {/* your bid */}
              {account && (
                <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4 space-y-2">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                    Your Bid
                  </p>
                  {selectedAuction.myBidUnsealed !== null ? (
                    <p className="text-lg font-bold text-[var(--text)] font-mono">
                      {selectedAuction.myBidUnsealed}
                    </p>
                  ) : (
                    <button
                      onClick={() => unsealMyBid(selectedAuction)}
                      disabled={unsealing || !initialized}
                      className="flex items-center gap-1.5 text-xs text-[var(--text)] hover:text-[var(--text)]
                                 transition-colors disabled:opacity-50"
                    >
                      {unsealing ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Eye size={12} />
                      )}
                      {unsealing ? "Processing..." : "View My Bid"}
                    </button>
                  )}
                </div>
              )}

              {/* winner */}
              {selectedAuction.status >= 2 &&
                selectedAuction.revealedBidder !==
                  "0x0000000000000000000000000000000000000000" && (
                  <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-4 space-y-2">
                    <p className="text-xs text-[var(--text)]/60 uppercase tracking-wider font-semibold">
                      Winner
                    </p>
                    <p className="text-sm text-[var(--text)] font-mono">
                      {shortAddr(selectedAuction.revealedBidder)}
                    </p>
                    <p className="text-lg font-bold text-[var(--text)]">
                      Winning Bid: {selectedAuction.revealedBid}
                    </p>
                  </div>
                )}

              {/* flow steps */}
              <div className="rounded bg-[var(--bg)]/60 border border-[var(--border-dash)] p-4">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-3">
                  Auction Flow
                </p>
                <div className="space-y-2">
                  {[
                    { n: 1, label: "Bidding",  desc: "Bidders submit encrypted bids", done: selectedAuction.status >= 1 },
                    { n: 2, label: "Close", desc: "Seller closes after deadline, triggers FHE decrypt",  done: selectedAuction.status >= 1 },
                    { n: 3, label: "Reveal", desc: "Retrieve decrypted winner from co-processor", done: selectedAuction.status >= 2 },
                    { n: 4, label: "Settle", desc: "Tokens transfer to winner, payment to seller", done: selectedAuction.status >= 3 },
                  ].map((s) => (
                    <div key={s.n} className="flex items-center gap-3">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          s.done
                            ? "bg-[var(--bg-alt)] text-[var(--text)] border border-[var(--border-dash)]"
                            : "bg-bgAlt text-[var(--text-muted)] border border-borderDash"
                        }`}
                      >
                        {s.done ? <CheckCircle2 size={12} /> : s.n}
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${s.done ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
                          {s.label}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* action buttons */}
              <div className="flex gap-3">
                {selectedAuction.status === 0 &&
                  !isSeller(selectedAuction) &&
                  selectedAuction.deadline > nowSec && (
                    <button
                      onClick={() => {
                        setBidAmount("");
                        setModalView("bid");
                      }}
                      className="flex-1 rounded py-2.5 text-sm font-semibold text-[var(--bg)]
                                 bg-[var(--text)]
                                   transition-all
                                 flex items-center justify-center gap-2"
                    >
                      <Lock size={14} />
                      Place Bid
                    </button>
                  )}

                {selectedAuction.status === 0 &&
                  isSeller(selectedAuction) &&
                  selectedAuction.deadline <= nowSec &&
                  selectedAuction.bidCount > 0 && (
                    <button
                      onClick={() => handleClose(selectedAuction.id)}
                      className="flex-1 rounded py-2.5 text-sm font-semibold
                                 bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text-muted)]
                                 hover:bg-[var(--bg-alt)] transition-all
                                 flex items-center justify-center gap-2"
                    >
                      <Clock size={14} />
                      Close Auction
                    </button>
                  )}

                {selectedAuction.status === 1 && (
                  <button
                    onClick={() => handleReveal(selectedAuction.id)}
                    disabled={txState === "decrypting" || txState === "signing"}
                    className="flex-1 rounded py-2.5 text-sm font-semibold
                               bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)]
                               hover:bg-[var(--bg-alt)] transition-all
                               disabled:opacity-50 disabled:cursor-not-allowed
                               flex items-center justify-center gap-2"
                    title="Reveals winner with Threshold Network signature"
                  >
                    <ShieldCheck size={14} />
                    Reveal Verified
                  </button>
                )}

                {selectedAuction.status === 2 && (
                  <button
                    onClick={() => handleSettle(selectedAuction.id)}
                    className="flex-1 rounded py-2.5 text-sm font-semibold
                               bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)]
                               hover:bg-[var(--bg-alt)] transition-all
                               flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={14} />
                    Settle
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Verifiable reveal proof drawer (W3.1 / W3.2) */}
      <SignatureDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={drawerProof}
      />
    </div>
  );
}
