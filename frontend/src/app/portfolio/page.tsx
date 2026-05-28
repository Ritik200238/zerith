"use client";

export const dynamic = "force-dynamic";

/**
 * Portfolio Tracker — /portfolio
 *
 * Encrypted portfolio valuation across vault balances. User tracks tokens
 * (delegating vault read access via SettlementVault.delegateBalanceRead),
 * then computes encrypted portfolio total = Σ (balance × price).
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PieChart, Plus, X, Loader2, RefreshCw, Lock, Eye,
  CheckCircle2, AlertCircle, Trash2, Calculator,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { formatAmount, isValidAddress, shortAddress } from "@/lib/format";

export default function PortfolioPage() {
  const { account } = useWallet();
  const { unseal } = useUnseal();
  const toast = useToast();

  // Use signer-bound contract for reads that depend on msg.sender (getPortfolioValue
  // returns the caller's encrypted total). The read-only provider sets msg.sender = 0x0
  // which would return the zero address's value, not the user's.
  const trackerContract = useContract("PortfolioTracker");
  const trackerRead = useContract("PortfolioTracker");
  const trackerReadProvider = useReadContract("PortfolioTracker");
  const vaultContract = useContract("SettlementVault");

  const deployed = CONTRACTS.PortfolioTracker !== "0x0000000000000000000000000000000000000000";

  const [tokens, setTokens] = useState<string[]>([]);
  const [encValueHandle, setEncValueHandle] = useState<string | null>(null);
  const [unsealedValue, setUnsealedValue] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [computeOpen, setComputeOpen] = useState(false);

  const [newToken, setNewToken] = useState(CONTRACTS.ConfidentialToken);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Portfolio", type: "system", href: "/portfolio", txHash });

  const modalProps = useModalEscape(modalOpen || computeOpen, () => { setModalOpen(false); setComputeOpen(false); }, "portfolio-modal-title");

  const fetchData = useCallback(async () => {
    if (!account) return;
    try {
      // getTrackedTokens(user) takes the address explicitly — read provider is fine.
      if (trackerReadProvider) {
        const list = await trackerReadProvider.getTrackedTokens(account);
        setTokens(list);
      }
      // getPortfolioValue() uses msg.sender — must use signer-bound contract.
      if (trackerRead) {
        try {
          const handle = await trackerRead.getPortfolioValue();
          setEncValueHandle(handle.toString());
        } catch {
          setEncValueHandle(null);
        }
      }
    } catch {
      /* noop */
    }
  }, [trackerRead, trackerReadProvider, account]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchData();
  }, [fetchData, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => {
    setTokens([]);
    setEncValueHandle(null);
    setUnsealedValue(null);
    setRefreshKey((k) => k + 1);
  }, []));

  const handleTrackToken = useCallback(async () => {
    if (!trackerContract || !vaultContract) return;
    if (!isValidAddress(newToken)) {
      toast.error("Invalid address", "Must be 0x + 40 hex");
      return;
    }
    setTxState("signing");
    try {
      const delegateTx = await vaultContract.delegateBalanceRead(CONTRACTS.PortfolioTracker, newToken);
      await delegateTx.wait();
      const tx = await trackerContract.trackToken(newToken);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setNewToken(CONTRACTS.ConfidentialToken);
      setModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Track failed", msg);
    }
  }, [trackerContract, vaultContract, newToken, toast]);

  const handleUntrack = useCallback(
    async (token: string) => {
      if (!trackerContract) return;
      setTxState("signing");
      try {
        const tx = await trackerContract.untrackToken(token);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Untrack failed", msg);
      }
    },
    [trackerContract, toast],
  );

  const handleCompute = useCallback(async () => {
    if (!trackerContract) return;
    if (tokens.length === 0) {
      toast.error("No tokens", "Track at least one token first");
      return;
    }
    const prices: bigint[] = [];
    for (const t of tokens) {
      const p = priceInputs[t];
      const num = Number(p);
      if (!Number.isFinite(num) || num <= 0) {
        toast.error("Invalid price", `Provide positive price for ${shortAddress(t)}`);
        return;
      }
      prices.push(BigInt(Math.floor(num)));
    }
    setTxState("signing");
    try {
      const tx = await trackerContract.computePortfolioValue(prices);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setComputeOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Compute failed", msg);
    }
  }, [trackerContract, tokens, priceInputs, toast]);

  const handleRevealValue = useCallback(async () => {
    if (!encValueHandle) return;
    const v = await unseal(BigInt(encValueHandle), 6);
    if (v !== null) setUnsealedValue(v.toString());
  }, [encValueHandle, unseal]);

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Portfolio Tracker" shipDate="soon" />
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
          — Portfolio tracker
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Encrypted total.{" "}<em className="font-serif italic font-normal">You see — nobody else does</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Track encrypted vault balances across multiple tokens. Compute Σ balance × price on ciphertext — only you unseal the total.
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
            <Plus size={14} /> Track token
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Your encrypted portfolio total
          </div>
          {tokens.length > 0 && (
            <button onClick={() => setComputeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
              <Calculator size={12} /> Recompute
            </button>
          )}
        </div>
        {!encValueHandle ? (
          <p className="text-sm text-[var(--text-muted)]">
            <Lock size={14} className="inline text-[var(--text)] mr-1" />
            No portfolio computed yet. Track tokens, then click Recompute.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-mono text-[var(--text)]">
                {unsealedValue !== null ? formatAmount(unsealedValue) : "•••••"}
              </div>
              {unsealedValue === null && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                  <Lock size={11} className="text-[var(--text)]" /> encrypted on-chain
                </p>
              )}
            </div>
            {unsealedValue === null ? (
              <button onClick={handleRevealValue}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
                <Eye size={12} /> Reveal to me
              </button>
            ) : (
              <button onClick={() => setUnsealedValue(null)}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Hide
              </button>
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
          Tracked tokens ({tokens.length})
        </h2>
        {tokens.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-6 text-center">
            <PieChart size={22} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-xs text-[var(--text-muted)]">
              No tokens tracked yet. Click <b>Track token</b> to add one.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((t) => (
              <div key={t} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{shortAddress(t)}</span>
                  {t.toLowerCase() === CONTRACTS.ConfidentialToken.toLowerCase() && (
                    <span className="text-[10px] text-[var(--text)]">CDEX</span>
                  )}
                </div>
                <button onClick={() => handleUntrack(t)} aria-label="Untrack"
                  className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {(modalOpen || computeOpen) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => { setModalOpen(false); setComputeOpen(false); }} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">

              {modalOpen && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="portfolio-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <PieChart size={18} className="text-[var(--text)]" /> Track token
                    </h3>
                    <button onClick={() => setModalOpen(false)} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Token address</label>
                    <input value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Two-step: delegate vault read to tracker, then add to your tracked list.
                    </p>
                  </div>
                  <button onClick={handleTrackToken} disabled={!newToken || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Delegate & track
                  </button>
                </>
              )}

              {computeOpen && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Calculator size={18} className="text-[var(--text)]" /> Recompute portfolio
                    </h3>
                    <button onClick={() => setComputeOpen(false)} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Provide a price (uint64) for each tracked token. Contract sums balance × price on ciphertext.
                  </p>
                  <div className="space-y-2">
                    {tokens.map((t) => (
                      <div key={t} className="space-y-1">
                        <label className="text-[10px] text-[var(--text-muted)] font-mono">{shortAddress(t)}</label>
                        <input
                          value={priceInputs[t] || ""}
                          onChange={(e) => setPriceInputs({ ...priceInputs, [t]: e.target.value })}
                          type="number" min={1} placeholder="100"
                          className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                        />
                      </div>
                    ))}
                  </div>
                  {!account && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Connect wallet to compute.</span>
                    </div>
                  )}
                  <button onClick={handleCompute} disabled={tokens.length === 0 || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Calculator size={14} />}
                    Compute on ciphertext
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
