"use client";

/**
 * Referrals — /referrals
 *
 * FHE-private referral system. Each referrer creates a code, accumulates
 * encrypted earnings as referred users transact. Earnings are revealed
 * only to the referrer via permit.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Share2, Plus, X, Loader2, RefreshCw, Lock, Eye, CheckCircle2, AlertCircle,
  Power, Tag, Users,
} from "lucide-react";
import { ethers } from "ethers";
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
import { formatAmount, shortAddress } from "@/lib/format";

interface MyLink {
  codeHash: string;
  referrer: string;
  rewardBps: number;
  referralCount: number;
  active: boolean;
}

type ModalView = "none" | "create" | "use";

export default function ReferralsPage() {
  const { account } = useWallet();
  const { unseal } = useUnseal();
  const toast = useToast();

  // getMyEarnings + referrerToCode(msg.sender lookups) — signer-bound for correctness.
  // getLinkStats / isReferred / userReferredBy take explicit address — read provider fine.
  const referralsContract = useContract("Referrals");
  const referralsRead = useContract("Referrals");
  const referralsReadProvider = useReadContract("Referrals");

  const deployed = CONTRACTS.Referrals !== "0x0000000000000000000000000000000000000000";

  const [myLink, setMyLink] = useState<MyLink | null>(null);
  const [encEarnedHandle, setEncEarnedHandle] = useState<string | null>(null);
  const [unsealedEarned, setUnsealedEarned] = useState<string | null>(null);
  const [referredBy, setReferredBy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");

  // create form
  const [code, setCode] = useState("");
  const [rewardBps, setRewardBps] = useState("500"); // 5% default

  // use code form
  const [useCode, setUseCode] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Referrals", type: "system", href: "/referrals", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "referrals-modal-title");

  /* ---- fetch ---- */

  const fetchData = useCallback(async () => {
    if (!account) return;
    const provider = referralsReadProvider;
    const signed = referralsRead;
    if (!provider) return;
    try {
      const myCodeHash = await provider.referrerToCode(account);
      if (myCodeHash !== ethers.ZeroHash) {
        const stats = await provider.getLinkStats(myCodeHash);
        setMyLink({
          codeHash: myCodeHash,
          referrer: stats[0],
          rewardBps: Number(stats[1]),
          referralCount: Number(stats[2]),
          active: stats[3],
        });
        // getMyEarnings uses msg.sender — signer-bound
        if (signed) {
          try {
            const handle = await signed.getMyEarnings();
            setEncEarnedHandle(handle.toString());
          } catch {
            setEncEarnedHandle(null);
          }
        }
      } else {
        setMyLink(null);
        setEncEarnedHandle(null);
      }

      const isRef = await provider.isReferred(account);
      if (isRef) {
        const myCode = await provider.userReferredBy(account);
        setReferredBy(myCode);
      } else {
        setReferredBy(null);
      }
    } catch {
      /* noop */
    }
  }, [referralsRead, referralsReadProvider, account]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchData();
  }, [fetchData, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => {
    setMyLink(null);
    setEncEarnedHandle(null);
    setUnsealedEarned(null);
    setReferredBy(null);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---- actions ---- */

  const handleCreate = useCallback(async () => {
    if (!referralsContract) return;
    if (!code) {
      toast.error("Code required", "Pick a unique referral code");
      return;
    }
    const bps = Number(rewardBps);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
      toast.error("Invalid reward", "0–5000 basis points (max 50%)");
      return;
    }
    setTxState("signing");
    try {
      const tx = await referralsContract.createLink(code, bps);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setCode("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Create failed", msg);
    }
  }, [referralsContract, code, rewardBps, toast]);

  const handleUseCode = useCallback(async () => {
    if (!referralsContract) return;
    if (!useCode) {
      toast.error("Code required", "Enter a referral code");
      return;
    }
    setTxState("signing");
    try {
      const tx = await referralsContract.useReferralCode(useCode);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setUseCode("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Use code failed", msg);
    }
  }, [referralsContract, useCode, toast]);

  const handleDeactivate = useCallback(async () => {
    if (!referralsContract) return;
    setTxState("signing");
    try {
      const tx = await referralsContract.deactivateLink();
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Deactivate failed", msg);
    }
  }, [referralsContract, toast]);

  const handleRevealEarned = useCallback(async () => {
    if (!encEarnedHandle) return;
    const v = await unseal(BigInt(encEarnedHandle), 5);
    if (v !== null) setUnsealedEarned(v.toString());
  }, [encEarnedHandle, unseal]);

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Referrals" shipDate="Wave 4 deploy" />
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
          — Referrals
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Encrypted earnings.{" "}<em className="font-serif italic font-normal">Anti-sybil by design</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Refer users via signed links. Each referrer&apos;s earnings stay encrypted — only you see your conversions and revenue share.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
          {!myLink && (
            <button onClick={() => setModalView("create")} disabled={!account}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
                         bg-gradient-to-r from-[var(--text)] to-[var(--text)]
                         text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all">
              <Plus size={14} /> Create code
            </button>
          )}
          {!referredBy && (
            <button onClick={() => setModalView("use")} disabled={!account}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors disabled:opacity-40">
              <Tag size={14} /> Use a code
            </button>
          )}
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="grid md:grid-cols-2 gap-4 mt-6">
        {/* My referral code */}
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2 flex items-center gap-1.5">
            <Share2 size={12} /> Your referral link
          </div>
          {!myLink ? (
            <p className="text-sm text-[var(--text-muted)]">
              You don&apos;t have a code yet. Click <b>Create code</b> to start earning on referred trades.
            </p>
          ) : (
            <>
              <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                hash: {myLink.codeHash.slice(0, 14)}…
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Reward</div>
                  <div className="font-mono text-sm text-[var(--text)]">{(myLink.rewardBps / 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Refs</div>
                  <div className="font-mono text-sm text-[var(--text)]">{myLink.referralCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Status</div>
                  <div className="text-sm">
                    {myLink.active ? <span className="text-[var(--text)]">ACTIVE</span> : <span className="text-[var(--text-muted)]">OFF</span>}
                  </div>
                </div>
              </div>
              {myLink.active && (
                <button onClick={handleDeactivate}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                  <Power size={12} /> Deactivate
                </button>
              )}
            </>
          )}
        </div>

        {/* My earnings */}
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2 flex items-center gap-1.5">
            <Lock size={12} /> Encrypted earnings
          </div>
          {!encEarnedHandle ? (
            <p className="text-sm text-[var(--text-muted)]">
              No earnings yet. Earnings accrue as users you referred transact.
            </p>
          ) : unsealedEarned !== null ? (
            <>
              <div className="text-3xl font-mono text-[var(--text)]">{formatAmount(unsealedEarned)} CDEX</div>
              <button onClick={() => setUnsealedEarned(null)}
                className="mt-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Hide
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-2xl font-mono text-[var(--text)]">•••</div>
              <button onClick={handleRevealEarned}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
                <Eye size={12} /> Reveal
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Are you referred? */}
      {referredBy && (
        <section className="mt-4 bg-white border border-dashed border-[var(--border-dash)] rounded-xl p-4 flex items-center gap-3">
          <Users size={18} className="text-[var(--text)]" />
          <div>
            <div className="text-xs text-[var(--text-secondary)]">You were referred</div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
              {referredBy.slice(0, 14)}…
            </div>
          </div>
        </section>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded-2xl w-full max-w-md p-5 space-y-4">

              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="referrals-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Share2 size={18} className="text-[var(--text)]" /> Create referral code
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded-lg hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Code</label>
                    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="alice2026"
                      className="w-full bg-[var(--bg-alt)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Reward (basis points, 0-5000 = 0%-50%)</label>
                    <input value={rewardBps} onChange={(e) => setRewardBps(e.target.value)} type="number" min={0} max={5000}
                      className="w-full bg-[var(--bg-alt)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleCreate} disabled={!code || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                               bg-gradient-to-r from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Create code
                  </button>
                </>
              )}

              {modalView === "use" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Tag size={18} className="text-[var(--text)]" /> Use referral code
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded-lg hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Register that you were referred. The referrer earns a share of platform fees on your future transactions.
                    One-time only — you can&apos;t change it later.
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Referral code</label>
                    <input value={useCode} onChange={(e) => setUseCode(e.target.value)} placeholder="alice2026"
                      className="w-full bg-[var(--bg-alt)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleUseCode} disabled={!useCode || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Register
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
