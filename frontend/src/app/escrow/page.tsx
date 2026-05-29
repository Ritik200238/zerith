"use client";

export const dynamic = "force-dynamic";

/**
 * Encrypted Escrow — /escrow
 *
 * Two-party deal with encrypted terms. A and B each have an encrypted
 * required amount; both fund their side; contract checks via FHE.eq +
 * AND that both deposits match terms. Release atomically swaps.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Plus, X, Loader2, RefreshCw, Lock, Clock,
  CheckCircle2, AlertCircle, Send, Wallet,
} from "lucide-react";
import { ethers } from "ethers";
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

interface DealData {
  id: number;
  partyA: string;
  partyB: string;
  tokenA: string;
  tokenB: string;
  status: number;
  deadline: number;
  dealHash: string;
}

const STATUS_LABEL: Record<number, string> = {
  0: "CREATED", 1: "FUNDED A", 2: "FUNDED BOTH", 3: "RELEASED", 4: "CANCELLED",
};
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  3: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  4: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
};

type ModalView = "none" | "create" | "fund";

export default function EscrowPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const escrowContract = useContract("Escrow");
  const escrowRead = useReadContract("Escrow");

  const deployed = CONTRACTS.Escrow !== "0x0000000000000000000000000000000000000000";

  const [deals, setDeals] = useState<DealData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedDeal, setSelectedDeal] = useState<DealData | null>(null);

  const [partyB, setPartyB] = useState("");
  const [tokenA, setTokenA] = useState(CONTRACTS.ConfidentialToken);
  const [tokenB, setTokenB] = useState(CONTRACTS.ConfidentialToken);
  const [termsA, setTermsA] = useState("");
  const [termsB, setTermsB] = useState("");
  const [duration, setDuration] = useState("3600");
  const [dealLabel, setDealLabel] = useState("");

  const [fundAmount, setFundAmount] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Escrow", type: "escrow", href: "/escrow", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "escrow-modal-title");

  /**
   * Normalize a tx/encryption error into a friendly { title, message }.
   * Maps wallet rejection and the Escrow contract's custom errors
   * (Unauthorized / InvalidInput / InvalidState / Expired / Paused —
   * see contracts/features/Escrow.sol) to human copy. Falls back to a
   * trimmed raw message so we never surface a raw stack trace.
   */
  const handleTxError = useCallback(
    (err: unknown, fallbackTitle: string) => {
      const raw = err instanceof Error ? err.message : String(err ?? "");
      const lower = raw.toLowerCase();

      const map: { match: string; title: string; message: string }[] = [
        {
          match: "user rejected",
          title: "Transaction cancelled",
          message: "You rejected the transaction in your wallet.",
        },
        {
          match: "unauthorized",
          title: "Not allowed",
          message: "Only a party to this deal can take that action.",
        },
        {
          match: "invalidstate",
          title: "Wrong deal state",
          message: "This deal isn't in a state that allows that action right now. Refresh and check the status.",
        },
        {
          match: "expired",
          title: "Deal expired",
          message: "The funding deadline has passed for this deal.",
        },
        {
          match: "invalidinput",
          title: "Invalid input",
          message: "One of the values was rejected by the contract. Check addresses, tokens, and amounts.",
        },
        {
          match: "paused",
          title: "Protocol paused",
          message: "Escrow is temporarily paused. Try again shortly.",
        },
        {
          match: "insufficient funds",
          title: "Insufficient gas funds",
          message: "Your wallet doesn't have enough Sepolia ETH to pay for gas.",
        },
        {
          match: "encryption failed",
          title: fallbackTitle,
          message: "Could not encrypt your inputs. Make sure FHE is initialized and retry.",
        },
      ];

      const hit = map.find((m) => lower.includes(m.match));
      const message = hit ? hit.message : raw.slice(0, 200) || "Transaction failed.";
      const title = hit ? hit.title : fallbackTitle;
      setTxState("error");
      setTxError(message);
      toast.error(title, message);
    },
    [toast],
  );

  const fetchDeals = useCallback(async () => {
    if (!escrowRead) return;
    try {
      const count = Number(await escrowRead.getDealCount());
      const indices = Array.from({ length: count }, (_, i) => i);
      const raws = await Promise.all(
        indices.map((i) => escrowRead.getDeal(i).catch(() => null)),
      );
      const out: DealData[] = [];
      raws.forEach((d, i) => {
        if (!d) return;
        out.push({
          id: i,
          partyA: d[0],
          partyB: d[1],
          tokenA: d[2],
          tokenB: d[3],
          status: Number(d[4]),
          deadline: Number(d[5]),
          dealHash: d[6],
        });
      });
      setDeals(out.reverse());
    } catch {
      /* noop */
    }
  }, [escrowRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchDeals();
  }, [fetchDeals, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  const handleCreate = useCallback(async () => {
    if (!escrowContract || !initialized) return;
    if (!isValidAddress(partyB)) {
      toast.error("Invalid party B", "Must be 0x + 40 hex");
      return;
    }
    if (!isValidAddress(tokenA) || !isValidAddress(tokenB) || tokenA === tokenB) {
      toast.error("Invalid tokens", "Distinct addresses required");
      return;
    }
    const aBn = parseAmount(termsA);
    const bBn = parseAmount(termsB);
    if (aBn === null || bBn === null) {
      toast.error("Invalid terms", "Both amounts must be positive");
      return;
    }
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "≥ 60 seconds");
      return;
    }
    setTxState("signing");
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(aBn), Encryptable.uint128(bBn)]);
      if (!enc) throw new Error("Encryption failed");
      const deadline = Math.floor(Date.now() / 1000) + dur;
      const dealHash = ethers.keccak256(ethers.toUtf8Bytes(dealLabel || `deal-${Date.now()}`));
      const tx = await escrowContract.createDeal(partyB, tokenA, tokenB, enc[0], enc[1], BigInt(deadline), dealHash);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setPartyB("");
      setTermsA("");
      setTermsB("");
      setDealLabel("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err, "Create failed");
    }
  }, [escrowContract, initialized, partyB, tokenA, tokenB, termsA, termsB, duration, dealLabel, encrypt, toast, handleTxError]);

  const handleFund = useCallback(async () => {
    if (!escrowContract || !initialized || !selectedDeal) return;
    const amt = parseAmount(fundAmount);
    if (amt === null) {
      toast.error("Invalid amount", "Positive number");
      return;
    }
    setTxState("signing");
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(amt)]);
      if (!enc) throw new Error("Encryption failed");
      const tx = await escrowContract.fundDeal(selectedDeal.id, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setFundAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err, "Fund failed");
    }
  }, [escrowContract, initialized, selectedDeal, fundAmount, encrypt, toast, handleTxError]);

  const handleRelease = useCallback(
    async (deal: DealData) => {
      if (!escrowContract) return;
      setTxState("signing");
      try {
        const tx = await escrowContract.releaseDeal(deal.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        handleTxError(err, "Release failed");
      }
    },
    [escrowContract, toast, handleTxError],
  );

  const handleCancel = useCallback(
    async (deal: DealData) => {
      if (!escrowContract) return;
      setTxState("signing");
      try {
        const tx = await escrowContract.cancelDeal(deal.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        handleTxError(err, "Cancel failed");
      }
    },
    [escrowContract, toast, handleTxError],
  );

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Encrypted Escrow" shipDate="soon" />
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
          — Escrow
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Trustless deals.{" "}<em className="font-serif italic font-normal">Encrypted amounts</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Buyer locks payment, seller delivers. Amounts stay private until release. Mediator can resolve without seeing dollar figures.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setModalView("create")} disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                       bg-text from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all">
            <Plus size={14} /> New deal
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="mt-6 grid gap-3">
        {deals.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            eyebrow="No deals yet"
            title="Two-party escrow with hidden settlement amounts."
            body="Both parties post encrypted terms. The contract checks them on ciphertext and only completes the trade if they match. Disputes don't leak the amounts. Use it when an OTC counterparty wants confidentiality on both legs."
            primary={{ label: "Create deal", onClick: () => setModalView("create") }}
            secondary={{ label: "First time? Run the quickstart", href: "/quickstart" }}
          />
        ) : (
          deals.map((d) => {
            const style = STATUS_STYLE[d.status];
            const isA = account && d.partyA.toLowerCase() === account.toLowerCase();
            const isB = account && d.partyB.toLowerCase() === account.toLowerCase();
            return (
              <article key={d.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{d.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                    {isA && <span className="text-[10px] text-[var(--text)]">you = A</span>}
                    {isB && <span className="text-[10px] text-[var(--text)]">you = B</span>}
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock size={12} /> {d.status < 3 ? formatRemaining(d.deadline) : "ended"}
                  </span>
                </div>
                <div className="mt-2 grid md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Party A → token A</div>
                    <div className="font-mono text-[var(--text-secondary)]">{shortAddress(d.partyA)} · {shortAddress(d.tokenA)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Party B → token B</div>
                    <div className="font-mono text-[var(--text-secondary)]">{shortAddress(d.partyB)} · {shortAddress(d.tokenB)}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {(isA || isB) && d.status < 2 && (
                    <button onClick={() => { setSelectedDeal(d); setModalView("fund"); }}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Wallet size={11} /> Fund
                    </button>
                  )}
                  {d.status === 2 && (isA || isB) && (
                    <button onClick={() => handleRelease(d)}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Send size={11} /> Release
                    </button>
                  )}
                  {d.status < 3 && (isA || isB) && (
                    <button onClick={() => handleCancel(d)}
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
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">

              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="escrow-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <ShieldCheck size={18} className="text-[var(--text)]" /> New escrow deal
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Party B (counterparty)</label>
                    <input value={partyB} onChange={(e) => setPartyB(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-xs text-[var(--text-muted)] font-medium">Token A (you give)</label>
                      <input value={tokenA} onChange={(e) => setTokenA(e.target.value)} placeholder="0x..."
                        className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-[var(--text-muted)] font-medium">Token B (B gives)</label>
                      <input value={tokenB} onChange={(e) => setTokenB(e.target.value)} placeholder="0x..."
                        className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                        <Lock size={11} className="text-[var(--text)]" /> Terms A
                      </label>
                      <input value={termsA} onChange={(e) => setTermsA(e.target.value)} placeholder="100"
                        className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                        <Lock size={11} className="text-[var(--text)]" /> Terms B
                      </label>
                      <input value={termsB} onChange={(e) => setTermsB(e.target.value)} placeholder="200"
                        className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Deal label (hashed)</label>
                    <input value={dealLabel} onChange={(e) => setDealLabel(e.target.value)} placeholder="my-trade-spec"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Duration (seconds)</label>
                    <input value={duration} onChange={(e) => setDuration(e.target.value)} type="number" min={60}
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  {!initialized && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button onClick={handleCreate} disabled={!initialized || !partyB || !termsA || !termsB || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Encrypt & create
                  </button>
                </>
              )}

              {modalView === "fund" && selectedDeal && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Wallet size={18} className="text-[var(--text)]" /> Fund deal #{selectedDeal.id}
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Encrypt the amount you&apos;re funding. Contract checks (on ciphertext) that it matches your terms.
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Amount (encrypted)
                    </label>
                    <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder="100"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleFund} disabled={!initialized || !fundAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Wallet size={14} />}
                    Encrypt & fund
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
