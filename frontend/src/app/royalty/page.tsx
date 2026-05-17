"use client";

/**
 * Encrypted Royalty Splits — /royalty
 *
 * On-chain royalty registry with encrypted per-recipient percentages.
 * Distribution multiplies amount × encPct / 10000 on ciphertext per recipient.
 *
 * Flow: Register split (recipients + encrypted basis-point shares) →
 * Distribute amount → contract pays out proportionally on ciphertext.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Music, Plus, X, Loader2, RefreshCw, Lock, Send, Trash2,
  CheckCircle2, AlertCircle, Wallet, Users,
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
import { isValidAddress, shortAddress } from "@/lib/format";

interface RoyaltyData {
  id: number;
  creator: string;
  token: string;
  recipientCount: number;
  recipients: string[];
}

type ModalView = "none" | "register" | "distribute";

export default function RoyaltyPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const royaltyContract = useContract("EncryptedRoyalty");
  const royaltyRead = useReadContract("EncryptedRoyalty");
  const tokenContract = useContract("ConfidentialToken");

  const deployed =
    CONTRACTS.EncryptedRoyalty !== "0x0000000000000000000000000000000000000000";

  const [royalties, setRoyalties] = useState<RoyaltyData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedRoyalty, setSelectedRoyalty] = useState<RoyaltyData | null>(null);

  // register form: parallel arrays
  const [recipients, setRecipients] = useState<{ addr: string; bps: string }[]>([
    { addr: "", bps: "" },
  ]);

  // distribute form
  const [distributeAmount, setDistributeAmount] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Royalty Splits", type: "payment", href: "/royalty", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "royalty-modal-title");

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchRoyalties = useCallback(async () => {
    if (!royaltyRead) return;
    try {
      const count = Number(await royaltyRead.getRoyaltyCount());
      const out: RoyaltyData[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const r = await royaltyRead.royalties(i);
          const recList = await royaltyRead.getRecipients(i);
          out.push({
            id: i,
            creator: r.creator,
            token: r.token,
            recipientCount: Number(r.recipientCount),
            recipients: recList,
          });
        } catch {
          /* skip */
        }
      }
      setRoyalties(out.reverse());
    } catch {
      /* noop */
    }
  }, [royaltyRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchRoyalties();
  }, [fetchRoyalties, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => {
    setSelectedRoyalty(null);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const addRecipientRow = () => {
    if (recipients.length >= 10) {
      toast.error("Limit reached", "Max 10 recipients per split");
      return;
    }
    setRecipients([...recipients, { addr: "", bps: "" }]);
  };

  const removeRecipientRow = (idx: number) => {
    setRecipients(recipients.filter((_, i) => i !== idx));
  };

  const updateRecipientRow = (idx: number, field: "addr" | "bps", value: string) => {
    const next = [...recipients];
    next[idx] = { ...next[idx], [field]: value };
    setRecipients(next);
  };

  const totalBps = recipients.reduce((sum, r) => sum + (Number(r.bps) || 0), 0);

  const handleRegister = useCallback(async () => {
    if (!royaltyContract || !initialized) return;
    const valid = recipients.filter((r) => r.addr && r.bps);
    if (valid.length === 0) {
      toast.error("No recipients", "Add at least one row");
      return;
    }
    if (valid.length > 10) {
      toast.error("Too many", "Max 10 recipients");
      return;
    }
    for (const r of valid) {
      if (!isValidAddress(r.addr)) {
        toast.error("Invalid address", `${String(r.addr).slice(0, 10)}… is not a valid 0x address`);
        return;
      }
      const bps = Number(r.bps);
      if (!Number.isFinite(bps) || bps <= 0 || bps > 10000) {
        toast.error("Invalid basis points", "Each share must be 1–10000");
        return;
      }
    }
    if (totalBps !== 10000) {
      toast.error("Sum mismatch", `Total must be 10000 (got ${totalBps})`);
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      const { Encryptable } = await import("cofhejs/web");
      const encItems = valid.map((r) => Encryptable.uint64(BigInt(Number(r.bps))));
      const enc = await encrypt(encItems);
      if (!enc) throw new Error("Encryption failed");

      const tx = await royaltyContract.register(
        CONTRACTS.ConfidentialToken,
        valid.map((r) => r.addr),
        enc,
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setRecipients([{ addr: "", bps: "" }]);
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Register failed", msg);
    }
  }, [royaltyContract, initialized, recipients, totalBps, encrypt, toast]);

  const handleDistribute = useCallback(async () => {
    if (!royaltyContract || !tokenContract || !selectedRoyalty) return;
    const amount = Number(distributeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Invalid amount", "Positive number");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      // Approve royalty contract to pull from caller's token balance
      const approveTx = await tokenContract.approve(CONTRACTS.EncryptedRoyalty, amount);
      await approveTx.wait();

      const tx = await royaltyContract.distribute(selectedRoyalty.id, BigInt(amount));
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setDistributeAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Distribute failed", msg);
    }
  }, [royaltyContract, tokenContract, selectedRoyalty, distributeAmount, toast]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Encrypted Royalty Splits" shipDate="Wave 4 deploy" />
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
          — Royalty splits
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Composable fan-out.{" "}<em className="font-serif italic font-normal">Each share private</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Programmable royalty splits where individual shares are encrypted. Authors, labels, contributors — each sees only their cut.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setModalView("register")} disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
                       bg-gradient-to-r from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all">
            <Plus size={14} /> New split
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="mt-6 grid gap-3">
        {royalties.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
            <Music size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">No royalty splits yet</p>
          </div>
        ) : (
          royalties.map((r) => (
            <article key={r.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">#{r.id}</span>
                  <span className="text-sm text-[var(--text-secondary)]">by {shortAddress(r.creator)}</span>
                  <span className="text-[10px] text-[var(--text)]">{r.recipientCount} recipients</span>
                </div>
                {account && (
                  <button onClick={() => { setSelectedRoyalty(r); setModalView("distribute"); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                    <Send size={12} /> Distribute
                  </button>
                )}
              </div>
              <div className="mt-3 grid md:grid-cols-2 gap-2 text-[11px]">
                {r.recipients.map((addr, i) => (
                  <div key={i} className="rounded-lg bg-[var(--bg-alt)]/40 p-2 flex items-center justify-between">
                    <span className="font-mono text-[var(--text-secondary)]">{shortAddress(addr)}</span>
                    <span className="flex items-center gap-1 text-[var(--text)]">
                      <Lock size={10} /> encrypted %
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>

      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">

              {modalView === "register" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="royalty-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Music size={18} className="text-[var(--text)]" /> Register split
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded-lg hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Each share is in basis points (out of 10000). They must sum to 10000.
                    <span className="text-[var(--text)] ml-1">Shares are encrypted on-chain.</span>
                  </p>
                  <div className="space-y-2">
                    {recipients.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={r.addr} onChange={(e) => updateRecipientRow(i, "addr", e.target.value)} placeholder="0x..."
                          className="flex-1 bg-[var(--bg-alt)] rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                        <input value={r.bps} onChange={(e) => updateRecipientRow(i, "bps", e.target.value)} placeholder="bps"
                          type="number" min={1} max={10000}
                          className="w-20 bg-[var(--bg-alt)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                        {recipients.length > 1 && (
                          <button onClick={() => removeRecipientRow(i)} aria-label="Remove row"
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button onClick={addRecipientRow} disabled={recipients.length >= 10}
                      className="w-full py-1.5 rounded-lg text-[11px] text-[var(--text)] hover:bg-[var(--text)]/10 transition-colors disabled:opacity-40">
                      + Add recipient ({recipients.length}/10)
                    </button>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-alt)]/40 p-2.5 flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Total basis points</span>
                    <span className={`font-mono ${totalBps === 10000 ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
                      {totalBps} / 10000
                    </span>
                  </div>
                  {!initialized && (
                    <div className="rounded-lg bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button onClick={handleRegister} disabled={!initialized || totalBps !== 10000 || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                               bg-gradient-to-r from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Users size={14} />}
                    Encrypt & register
                  </button>
                </>
              )}

              {modalView === "distribute" && selectedRoyalty && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Send size={18} className="text-[var(--text)]" /> Distribute split #{selectedRoyalty.id}
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded-lg hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Total amount to distribute</label>
                    <input value={distributeAmount} onChange={(e) => setDistributeAmount(e.target.value)} type="number" placeholder="1000"
                      className="w-full bg-[var(--bg-alt)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Will be split across {selectedRoyalty.recipientCount} recipients per their encrypted percentages.
                    </p>
                  </div>
                  <button onClick={handleDistribute} disabled={!distributeAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Wallet size={14} />}
                    Approve & distribute
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
