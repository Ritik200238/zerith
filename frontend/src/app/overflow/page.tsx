"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Droplets,
  Lock,
  X,
  Plus,
  Loader2,
  Timer,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Users,
  Shield,
  TrendingUp,
  PieChart,
  Download,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useBlockPoll } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useAccountChangeReset } from "@/hooks/useBlockPoll";
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

/* ------------------------------------------------------------------ */
/*  Types */
/* ------------------------------------------------------------------ */

interface SaleData {
  id: number;
  creator: string;
  token: string;
  paymentToken: string;
  totalSupply: string;
  pricePerToken: string;
  deadline: number;
  depositCount: number;
  status: number; // 0=OPEN 1=SETTLED 2=CANCELLED
  oversubscribed: boolean;
  myAllocation: string | null;
}

type ModalView = "none" | "create" | "deposit";

/* ------------------------------------------------------------------ */
/*  Constants */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<number, string> = { 0: "OPEN", 1: "SETTLED", 2: "CANCELLED" };
const STATUS_STYLE: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
};

const DURATION_OPTS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hrs", value: 86400 },
  { label: "7 days", value: 604800 },
];

const TOKEN_OPTIONS = [
  { label: "CDEX", address: CONTRACTS.ConfidentialToken, symbol: "CDEX" },
  { label: "MOCK", address: CONTRACTS.MockToken, symbol: "MOCK" },
];

function tokenSymbol(addr: string): string {
  const hit = TOKEN_OPTIONS.find((t) => t.address.toLowerCase() === addr.toLowerCase());
  return hit ? hit.symbol : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function CountdownBadge({ deadline }: { deadline: number }) {
  const str = useCountdown(deadline);
  const now = Math.floor(Date.now() / 1000);
  const ended = deadline <= now;
  return (
    <span className={`font-mono text-xs ${ended ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>{str}</span>
  );
}

/* ================================================================== */
/*  OverflowSalePage */
/* ================================================================== */

export default function OverflowSalePage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const saleContract = useContract("OverflowSale");
  const saleRead = useReadContract("OverflowSale");

  const [sales, setSales] = useState<SaleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [modalView, setModalView] = useState<ModalView>("none");
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));
  const [selectedSale, setSelectedSale] = useState<SaleData | null>(null);

  /* ---- create form ---- */
  const [cToken, setCToken] = useState<string>(CONTRACTS.ConfidentialToken);
  const [cPayToken, setCPayToken] = useState<string>("");
  const [cSupply, setCSupply] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cDuration, setCDuration] = useState(86400);

  const [depositAmount, setDepositAmount] = useState("");
  const [revealAlloc, setRevealAlloc] = useState(false);

  const { decrypt: decryptForTx } = useDecryptForTx();

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const depositFlow = useTxFlow();
  useTxFeedback(txState, { label: "Overflow Sale", type: "auction", href: "/overflow", txHash });
  const [txError, setTxError] = useState<string | undefined>();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProof, setDrawerProof] = useState<SignatureProof | null>(null);

  const busyRef = useRef<Set<string>>(new Set());
  const deployed = CONTRACTS.OverflowSale !== "0x0000000000000000000000000000000000000000";

  const isCreator = (s: SaleData) =>
    account !== null && s.creator.toLowerCase() === account.toLowerCase();

  /* ---------------------------------------------------------------- */
  /*  Fetch */
  /* ---------------------------------------------------------------- */

  const fetchSales = useCallback(async () => {
    if (!saleRead) return;
    setLoading(true);
    try {
      const total = Number(await saleRead.getSaleCount());
      const list: SaleData[] = [];
      for (let i = 0; i < total; i++) {
        const s = await saleRead.getSale(i);
        list.push({
          id: i,
          creator: s[0],
          token: s[1],
          paymentToken: s[2],
          totalSupply: s[3].toString(),
          pricePerToken: s[4].toString(),
          deadline: Number(s[5]),
          depositCount: Number(s[6]),
          status: Number(s[7]),
          oversubscribed: s[8],
          myAllocation: null,
        });
      }
      list.reverse();
      setSales(list);
    } catch {
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [saleRead]);

  const blockTick = useBlockPoll();
  useEffect(() => { fetchSales(); }, [fetchSales, refreshKey, blockTick]);

  useAccountChangeReset(useCallback(() => {
    setSales((prev) => prev.map((s) => ({ ...s, myAllocation: null })));
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---- tx helpers ---- */

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
    if (!saleContract || !cToken || !cPayToken || !cSupply || !cPrice) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    try {
      const supplyBn = parseAmount(cSupply);
      const priceBn = parseAmount(cPrice);
      if (supplyBn === null || priceBn === null) {
        toast.error("Invalid input", "Supply and price must be positive numbers");
        setTxState("idle");
        return;
      }
      const tx = await saleContract.createSale(
        cToken, cPayToken, supplyBn, priceBn, BigInt(cDuration),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setCSupply(""); setCPrice("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [saleContract, cToken, cPayToken, cSupply, cPrice, cDuration]);

  const handleDeposit = useCallback(async () => {
    if (!saleContract || !initialized || !selectedSale || !depositAmount) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    depositFlow.begin();
    try {
      const depositBn = parseAmount(depositAmount);
      if (depositBn === null) {
        toast.error("Invalid amount", "Deposit must be a positive number");
        setTxState("idle");
        depositFlow.close();
        return;
      }
      const { Encryptable } = await import("@cofhe/sdk");
      // Audit fix B3: OverflowSale.deposit expects InEuint64
      const enc = await encrypt([Encryptable.uint64(depositBn)]);
      if (!enc) throw new Error("Encryption failed");
      depositFlow.submitted();
      const tx = await saleContract.deposit(selectedSale.id, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      depositFlow.confirmed(tx.hash);
      await tx.wait();
      setTxState("success");
      depositFlow.sealed();
      setDepositAmount("");
      setModalView("none");
      setSelectedSale(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      depositFlow.failed(err);
      handleTxError(err);
    }
  }, [saleContract, initialized, selectedSale, depositAmount, encrypt, depositFlow]);

  /**
   * Two-stage settle (audit fix D-OS1):
   * 1. settle(id) — marks total demand publicly decryptable via FHE.allowGlobal
   * 2. anyone fetches TN signature for total demand
   * 3. finalizeSettlement(id, totalDemand, signature) — verifies + transitions
   */
  const handleSettle = useCallback(
    (id: number) => guardedAction(`settle-${id}`, async () => {
      if (!saleContract) throw new Error("Sale contract not ready");

      // Step 1: signal settle (marks publicly decryptable)
      setTxState("signing");
      const settleTx = await saleContract.settle(id);
      setTxState("confirming");
      setTxHash(settleTx.hash);
      await settleTx.wait();

      // Step 2: read encrypted total handle
      const sale = await saleContract.sales(id);
      const totalHandle = sale.totalDeposited as unknown as string;

      // Step 3: TN signature
      setTxState("decrypting");
      const proof = await decryptForTx(totalHandle);
      if (!proof) throw new Error("Total demand decryption failed");

      // Step 4: finalize on-chain
      setTxState("signing");
      const finTx = await saleContract.finalizeSettlement(id, proof.decryptedValue, proof.signature);
      setTxState("confirming");
      setTxHash(finTx.hash);
      await finTx.wait();
      setTxState("success");

      setDrawerProof({
        ctHash: totalHandle,
        decryptedValue: `${formatAmount(proof.decryptedValue.toString())} (total demand)`,
        signature: proof.signature,
        txHash: finTx.hash,
        chainId: FHENIX_TESTNET.chainId,
        label: "Sale total demand",
      });
      setDrawerOpen(true);
    }),
    [saleContract, guardedAction, decryptForTx],
  );

  /**
   * Per-depositor claim (audit fix D-OS2):
   * Frontend scans deposits to find caller's unclaimed deposit, then runs
   * the 3-step verifiable claim (claimAllocation → decryptForTx → finalize).
   */
  const handleClaim = useCallback(
    (saleId: number) =>
      guardedAction(`claim-${saleId}`, async () => {
        if (!saleContract || !account) throw new Error("Not ready");

        // Find the caller's first unclaimed deposit index
        let depositIndex = -1;
        // Try up to 50 deposits per sale
        for (let i = 0; i < 50; i++) {
          try {
            const dep = await saleContract.deposits(saleId, i);
            if (
              dep.depositor.toLowerCase() === account.toLowerCase() &&
              !dep.claimed
            ) {
              depositIndex = i;
              break;
            }
          } catch {
            break; // out of bounds = no more deposits
          }
        }
        if (depositIndex === -1) throw new Error("No unclaimed deposit found");

        setTxState("signing");
        const claimTx = await saleContract.claimAllocation(saleId, depositIndex);
        setTxState("confirming");
        setTxHash(claimTx.hash);
        await claimTx.wait();

        const dep = await saleContract.deposits(saleId, depositIndex);
        const amountHandle = dep.encAmount as unknown as string;

        setTxState("decrypting");
        const proof = await decryptForTx(amountHandle);
        if (!proof) throw new Error("Deposit decryption failed");

        setTxState("signing");
        const finTx = await saleContract.finalizeClaimAllocation(
          saleId,
          depositIndex,
          proof.decryptedValue,
          proof.signature,
        );
        setTxState("confirming");
        setTxHash(finTx.hash);
        await finTx.wait();
        setTxState("success");

        setDrawerProof({
          ctHash: amountHandle,
          decryptedValue: `${formatAmount(proof.decryptedValue.toString())} (your deposit)`,
          signature: proof.signature,
          txHash: finTx.hash,
          chainId: FHENIX_TESTNET.chainId,
          label: "Your deposit allocation",
        });
        setDrawerOpen(true);
      }),
    [saleContract, guardedAction, decryptForTx],
  );

  const handleUnsealAllocation = useCallback(async (sale: SaleData) => {
    if (!saleContract || !account) return;
    try {
      const hash = await saleContract.getMyAllocation(sale.id);
      const val = await unseal(BigInt(hash), 5);
      if (val !== null) {
        setSales((prev) =>
          prev.map((s) => (s.id === sale.id ? { ...s, myAllocation: val.toString() } : s))
        );
        setRevealAlloc(true);
      }
    } catch {
      // no allocation or unseal failed
    }
  }, [saleContract, account, unseal]);

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
          — Overflow / fixed-price sale
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Fixed price.{" "}<em className="font-serif italic font-normal">Pro-rata when overfilled</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Buyers commit encrypted amounts at a public fixed price. If total demand exceeds supply, allocations pro-rate fairly.
            </p>
          </div>
        <div className="flex items-center gap-3">
          <FaucetButton />
          {account && (
            <button
              onClick={() => { setModalView("create"); setTxState("idle"); }}
              className="flex items-center gap-2 px-4 py-2 rounded
                         bg-text text-[var(--bg)] text-sm font-medium
                           transition-all"
            >
              <Plus size={16} />
              Create Sale
            </button>
          )}
        </div>
      </div>

      {!account && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-10 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded flex items-center justify-center" style={{ background: "var(--text)" }}>
            <Droplets size={24} style={{ color: "var(--bg)" }} />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Connect your wallet</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Participate in token sales with encrypted deposit amounts.
            If oversubscribed, tokens are allocated pro-rata.
          </p>
        </div>
      )}

      {account && !deployed && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 border-[var(--border-dash)] flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--text-muted)]">OverflowSale contract not deployed yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Deploy the contracts and update the address in constants.ts.</p>
          </div>
        </div>
      )}

      {account && (
        <div className="flex items-center gap-3 px-4 py-3 rounded bg-bgAlt border border-borderDash">
          <TrendingUp size={16} className="text-text shrink-0" />
          <p className="text-xs text-text/80">
            <strong>Fair overflow:</strong> Deposit encrypted amounts at a fixed price.
            If total deposits exceed supply, each participant gets a pro-rata share.
            Excess funds are refunded. Deposit amounts stay private.
          </p>
        </div>
      )}

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />
      <EncryptionProgress stage={stage} visible={encrypting} />

      {account && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">{sales.length} sale{sales.length !== 1 ? "s" : ""}</p>
          <button onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-text transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      )}</div>
      

      {/* Sale grid */}
      {account && (
        <>
          {loading && sales.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-text animate-spin" />
            </div>
          ) : sales.length === 0 ? (
            <EmptyState
              icon={Droplets}
              eyebrow="No overflow sales yet"
              title="Open the first overflow sale."
              body="Buyers commit encrypted deposits during the window. If the round is oversubscribed, everyone gets a pro-rata allocation — no whales front-running the cap."
              primary={{ label: "Create Sale", onClick: () => { setModalView("create"); setTxState("idle"); } }}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sales.map((sale) => {
                const style = STATUS_STYLE[sale.status] ?? STATUS_STYLE[0];
                const mine = isCreator(sale);
                const nowSec = Math.floor(Date.now() / 1000);
                const ended = sale.deadline <= nowSec;

                return (
                  <motion.div
                    key={sale.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="overflow-hidden hover:border-borderDash transition-all"
                  >
                    <div className="px-5 py-4 border-b border-borderDash flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--text-muted)]">#{sale.id}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}>
                          {STATUS_LABEL[sale.status]}
                        </span>
                        {sale.oversubscribed && sale.status === 1 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-[var(--bg-alt)] text-[var(--text-muted)] border-[var(--border-dash)]">
                            OVERSUBSCRIBED
                          </span>
                        )}
                      </div>
                      {mine && (
                        <span className="text-[10px] text-text bg-bgAlt px-2 py-0.5 rounded">Your Sale</span>
                      )}
                    </div>

                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Supply</p>
                          <p className="text-lg font-bold text-[var(--text)] break-words">
                            {formatAmount(sale.totalSupply)}{" "}
                            <span className="text-sm font-medium text-text">{tokenSymbol(sale.token)}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--text-muted)]">Price</p>
                          <p className="text-sm font-bold text-[var(--text)] font-mono break-words">
                            {formatAmount(sale.pricePerToken)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Timer size={12} className="text-[var(--text)]/60" />
                          <CountdownBadge deadline={sale.deadline} />
                        </div>
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Users size={12} className="text-text/60" />
                          {sale.depositCount} deposit{sale.depositCount !== 1 ? "s" : ""}
                        </div>
                      </div>

                      {/* Allocation (after settle) */}
                      {sale.status === 1 && sale.myAllocation !== null && (
                        <div className="rounded bg-bgAlt border border-borderDash px-3 py-2">
                          <p className="text-[10px] text-text/60 uppercase tracking-wider font-semibold">Your Allocation</p>
                          <p className="text-sm text-text font-semibold font-mono">{sale.myAllocation} tokens</p>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                        <Lock size={10} className="text-text/40" />
                        Deposit amounts encrypted with FHE
                      </div>
                    </div>

                    <div className="px-5 py-3 border-t border-borderDash flex items-center gap-2">
                      {sale.status === 0 && !ended && !mine && (
                        <button
                          onClick={() => { setSelectedSale(sale); setDepositAmount(""); setModalView("deposit"); setTxState("idle"); }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-text text-[var(--bg)] transition-all"
                        >
                          <Lock size={12} /> Deposit
                        </button>
                      )}
                      {sale.status === 0 && mine && ended && (
                        <button onClick={() => handleSettle(sale.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all">
                          <CheckCircle2 size={12} /> Settle
                        </button>
                      )}
                      {sale.status === 1 && !mine && (
                        <button onClick={() => handleClaim(sale.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--bg-alt)] border border-[var(--border-dash)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all">
                          <Download size={12} /> Claim Tokens
                        </button>
                      )}
                      {sale.status === 1 && sale.myAllocation === null && !mine && (
                        <button onClick={() => handleUnsealAllocation(sale)}
                          disabled={unsealing}
                          className="rounded px-3 py-2 text-xs font-medium bg-bgCard border border-borderDash text-[var(--text-muted)]
                                     hover:text-[var(--text)] hover:bg-bgCard transition-all disabled:opacity-50">
                          {unsealing ? <Loader2 size={12} className="animate-spin" /> : <PieChart size={12} />}
                          {unsealing ? "..." : "Allocation"}
                        </button>
                      )}
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
                  <Droplets size={18} className="text-text" /> Create Overflow Sale
                </h3>
                <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Token to Sell</label>
                <select value={cToken} onChange={(e) => setCToken(e.target.value)}
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-borderDash text-sm text-[var(--text)] focus:outline-none focus:border-borderDash transition-colors">
                  {TOKEN_OPTIONS.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Payment Token</label>
                <select value={cPayToken} onChange={(e) => setCPayToken(e.target.value)}
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-borderDash text-sm text-[var(--text)] focus:outline-none focus:border-borderDash transition-colors">
                  <option value="">Select token</option>
                  {TOKEN_OPTIONS.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Total Supply</label>
                  <input type="number" value={cSupply} onChange={(e) => setCSupply(e.target.value)} placeholder="10000" min="0"
                    className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-borderDash text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-borderDash transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Price per Token</label>
                  <input type="number" value={cPrice} onChange={(e) => setCPrice(e.target.value)} placeholder="100" min="0"
                    className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-borderDash text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-borderDash transition-colors" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTS.map((d) => (
                    <button key={d.value} type="button" onClick={() => setCDuration(d.value)}
                      className={`rounded px-3 py-2 text-xs font-medium border transition-all ${
                        cDuration === d.value
                          ? "bg-bgAlt border-borderDash text-text"
                          : "bg-[var(--bg)] border-borderDash text-[var(--text-muted)] hover:border-borderDash"
                      }`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleCreate}
                disabled={txState === "signing" || txState === "confirming" || !cSupply || !cPrice || !cPayToken}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-text text-[var(--bg)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {txState === "signing" || txState === "confirming" ? (
                  <><Loader2 size={16} className="animate-spin" /> Processing...</>
                ) : (
                  <><Plus size={16} /> Create Overflow Sale</>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== DEPOSIT MODAL ======================== */}
      <AnimatePresence>
        {modalView === "deposit" && selectedSale && (
          <motion.div key="deposit-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}>
            <motion.div key="deposit-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-6 space-y-5 ">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Lock size={18} className="text-text" /> Deposit
                </h3>
                <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="rounded bg-bgAlt border border-borderDash px-4 py-3 space-y-1">
                <p className="text-xs text-[var(--text-muted)]">Sale #{selectedSale.id}</p>
                <p className="text-sm font-semibold text-[var(--text)]">
                  {selectedSale.totalSupply} {tokenSymbol(selectedSale.token)} @ {selectedSale.pricePerToken} each
                </p>
                <p className="text-xs text-[var(--text-muted)]">{selectedSale.depositCount} deposits so far</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Deposit Amount</label>
                <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-borderDash text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-borderDash transition-colors" />
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded bg-bgAlt border border-borderDash">
                <Shield size={12} className="text-text shrink-0" />
                <p className="text-[10px] text-text/70">
                  Your deposit amount is encrypted. If oversubscribed, you receive a proportional allocation and a refund.
                </p>
              </div>

              <button onClick={handleDeposit}
                disabled={txState === "signing" || txState === "confirming" || encrypting || !depositAmount}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-text text-[var(--bg)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {encrypting ? (
                  <><Loader2 size={16} className="animate-spin" /> Encrypting deposit...</>
                ) : txState === "signing" || txState === "confirming" ? (
                  <><Loader2 size={16} className="animate-spin" /> Processing...</>
                ) : (
                  <><Lock size={16} /> Deposit Encrypted Amount</>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SignatureDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={drawerProof}
      />

      <TxFlowDrawer
        open={depositFlow.step !== "idle"}
        step={depositFlow.step}
        subjectNoun="deposit"
        title={depositFlow.step === "sealed" ? "Deposit sealed" : "Sealing your deposit"}
        txHash={depositFlow.txHash}
        chainId={FHENIX_TESTNET.chainId}
        errorMessage={depositFlow.errorMessage}
        onClose={depositFlow.close}
        onRetry={() => { depositFlow.close(); void handleDeposit(); }}
      />
    </div>
  );
}
