"use client";

export const dynamic = "force-dynamic";

/**
 * Confidential Multisig — /multisig
 *
 * W5+ wow primitive. Multisig where threshold + voting shares are encrypted.
 * Settlement runs on ciphertext via FHE.gte + FHE.select; outside observers
 * see "execute called" but not whether it actually paid out.
 *
 * Flow: Create → Add members → Propose → Vote → Execute.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Plus, X, Loader2, RefreshCw, Lock, Users,
  CheckCircle2, AlertCircle, Vote, Send,
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
import { parseAmount, isValidAddress, shortAddress, formatRemaining } from "@/lib/format";

interface MultisigData {
  id: number;
  creator: string;
  token: string;
  memberCount: number;
  proposalCount: number;
  exists: boolean;
}

interface ProposalData {
  id: number;
  multisigId: number;
  recipient: string;
  createdAt: number;
  deadline: number;
  status: number; // 0=PENDING 1=EXECUTED 2=EXPIRED
}

const STATUS_LABEL: Record<number, string> = { 0: "PENDING", 1: "EXECUTED", 2: "EXPIRED" };
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  2: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]" },
};

type ModalView = "none" | "create" | "addMember" | "propose";

export default function MultisigPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();

  const multisigContract = useContract("ConfidentialMultisig");
  const multisigRead = useReadContract("ConfidentialMultisig");

  const deployed =
    CONTRACTS.ConfidentialMultisig !== "0x0000000000000000000000000000000000000000";

  const [multisigs, setMultisigs] = useState<MultisigData[]>([]);
  const [proposals, setProposals] = useState<Record<number, ProposalData[]>>({});
  const [selectedMultisig, setSelectedMultisig] = useState<MultisigData | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");

  // create form
  const [token, setToken] = useState(CONTRACTS.ConfidentialToken);
  const [threshold, setThreshold] = useState("100");

  // add member form
  const [memberAddr, setMemberAddr] = useState("");
  const [memberShare, setMemberShare] = useState("");

  // propose form
  const [proposalRecipient, setProposalRecipient] = useState("");
  const [proposalAmount, setProposalAmount] = useState("");
  const [proposalDuration, setProposalDuration] = useState("3600");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Confidential Multisig", type: "system", href: "/multisig", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "multisig-modal-title");

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchMultisigs = useCallback(async () => {
    if (!multisigRead) return;
    try {
      const count = Number(await multisigRead.getMultisigCount());
      const out: MultisigData[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const m = await multisigRead.multisigs(i);
          out.push({
            id: i,
            creator: m.creator,
            token: m.token,
            memberCount: Number(m.memberCount),
            proposalCount: Number(m.proposalCount),
            exists: m.exists,
          });
        } catch {
          /* skip */
        }
      }
      setMultisigs(out.reverse());

      // Fetch proposals for the selected multisig
      if (selectedMultisig) {
        try {
          const propCount = Number(await multisigRead.getProposalCount(selectedMultisig.id));
          const props: ProposalData[] = [];
          for (let p = 1; p <= propCount; p++) {
            try {
              const pr = await multisigRead.proposals(selectedMultisig.id, p);
              props.push({
                id: p,
                multisigId: selectedMultisig.id,
                recipient: pr.recipient,
                createdAt: Number(pr.createdAt),
                deadline: Number(pr.deadline),
                status: Number(pr.status),
              });
            } catch {
              /* skip */
            }
          }
          setProposals((prev) => ({ ...prev, [selectedMultisig.id]: props.reverse() }));
        } catch {
          /* noop */
        }
      }
    } catch {
      /* noop */
    }
  }, [multisigRead, selectedMultisig]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchMultisigs();
  }, [fetchMultisigs, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => {
    setSelectedMultisig(null);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleCreate = useCallback(async () => {
    if (!multisigContract || !initialized) return;
    if (!isValidAddress(token)) {
      toast.error("Invalid token", "Token address must be 0x-prefixed 40 hex chars");
      return;
    }
    const thresholdBn = parseAmount(threshold, 0); // raw uint64
    if (thresholdBn === null) {
      toast.error("Invalid threshold", "Must be a positive number");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint64(thresholdBn)]);
      if (!enc) throw new Error("Encryption failed");

      const tx = await multisigContract.createMultisig(token, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setThreshold("100");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      const isRej = err instanceof Error && err.message.includes("user rejected");
      toast.error(isRej ? "Cancelled" : "Create failed", isRej ? "" : msg);
    }
  }, [multisigContract, initialized, token, threshold, encrypt, toast]);

  const handleAddMember = useCallback(async () => {
    if (!multisigContract || !initialized || !selectedMultisig) return;
    if (!isValidAddress(memberAddr)) {
      toast.error("Invalid address", "Member must be a 0x-prefixed 40 hex char address");
      return;
    }
    const shareBn = parseAmount(memberShare, 0);
    if (shareBn === null) {
      toast.error("Invalid share", "Must be a positive number");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint64(shareBn)]);
      if (!enc) throw new Error("Encryption failed");

      const tx = await multisigContract.addMember(selectedMultisig.id, memberAddr, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setMemberAddr("");
      setMemberShare("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Add member failed", msg);
    }
  }, [multisigContract, initialized, selectedMultisig, memberAddr, memberShare, encrypt, toast]);

  const handlePropose = useCallback(async () => {
    if (!multisigContract || !initialized || !selectedMultisig) return;
    if (!isValidAddress(proposalRecipient)) {
      toast.error("Invalid recipient", "Address must be 0x + 40 hex");
      return;
    }
    const amountBn = parseAmount(proposalAmount);
    if (amountBn === null) {
      toast.error("Invalid amount", "Must be a positive number");
      return;
    }
    const dur = Number(proposalDuration);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "At least 60 seconds");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint64(amountBn)]);
      if (!enc) throw new Error("Encryption failed");

      const tx = await multisigContract.createProposal(
        selectedMultisig.id,
        proposalRecipient,
        enc[0],
        BigInt(dur),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setProposalRecipient("");
      setProposalAmount("");
      setProposalDuration("3600");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Propose failed", msg);
    }
  }, [multisigContract, initialized, selectedMultisig, proposalRecipient, proposalAmount, proposalDuration, encrypt, toast]);

  const handleVote = useCallback(
    async (multisigId: number, proposalId: number) => {
      if (!multisigContract) return;
      setTxState("signing");
      try {
        const tx = await multisigContract.vote(multisigId, proposalId);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Vote failed", msg);
      }
    },
    [multisigContract, toast],
  );

  const handleExecute = useCallback(
    async (multisigId: number, proposalId: number) => {
      if (!multisigContract) return;
      setTxState("signing");
      try {
        const tx = await multisigContract.execute(multisigId, proposalId);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Execute failed", msg);
      }
    },
    [multisigContract, toast],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Confidential Multisig" shipDate="soon" />
      </main>
    );
  }

  const selectedProposals = selectedMultisig ? (proposals[selectedMultisig.id] || []) : [];

  return (
    <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Encrypted multisig
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Quorum signatures.{" "}<em className="font-serif italic font-normal">Hidden amounts</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              M-of-N approval flow for encrypted transfers. Signers approve before they see the figure — true blind signing.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            aria-label="Refresh multisigs"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setModalView("create")}
            disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                       bg-text from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all"
          >
            <Plus size={14} /> New multisig
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      {/* Two-pane: list of multisigs + selected proposals */}
      <section className="grid md:grid-cols-3 gap-4 mt-6">
        {/* Multisigs list */}
        <aside className="space-y-3 md:col-span-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-1.5">
            <Users size={12} /> Multisigs
          </div>
          {multisigs.length === 0 ? (
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 4,
              }}
              className="p-4 space-y-2.5"
            >
              <div
                className="w-9 h-9 flex items-center justify-center"
                style={{
                  background: "var(--bg-alt)",
                  border: "1px dashed var(--border-dash)",
                  borderRadius: 4,
                }}
              >
                <Sparkles size={15} style={{ color: "var(--text)" }} />
              </div>
              <p
                className="font-mono uppercase tracking-[0.12em]"
                style={{ fontSize: 9.5, color: "var(--text-muted)" }}
              >
                — No multisigs yet
              </p>
              <p
                className="font-display font-semibold"
                style={{
                  fontSize: 14,
                  color: "var(--text)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.25,
                }}
              >
                Govern with a hidden threshold.
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Encrypted threshold and per-member voting weights. Observers
                see <em>that</em> a proposal executed, not <em>which</em> votes
                carried it.
              </p>
              <button
                type="button"
                onClick={() => setModalView("create")}
                className="text-xs font-semibold inline-flex items-center gap-1.5 mt-1"
                style={{ color: "var(--text)" }}
              >
                Create multisig →
              </button>
            </div>
          ) : (
            multisigs.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMultisig(m)}
                className={`w-full text-left bg-white border border-dashed border-[var(--border-dash)] rounded p-3 transition-colors hover:bg-bgCard ${
                  selectedMultisig?.id === m.id ? "ring-1 ring-[var(--text)]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">#{m.id}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{m.memberCount} members</span>
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  by {shortAddress(m.creator)}
                </div>
                <div className="mt-1 text-[10px] text-[var(--text)]">
                  {m.proposalCount} proposals
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Selected multisig detail */}
        <div className="md:col-span-2 space-y-3">
          {!selectedMultisig ? (
            <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
              <Vote size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-secondary)]">Pick a multisig from the left</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Or create one to start.</p>
            </div>
          ) : (
            <>
              <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Multisig</div>
                    <div className="font-mono text-sm text-[var(--text)]">#{selectedMultisig.id}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Creator</div>
                    <div className="font-mono text-xs text-[var(--text-secondary)]">{shortAddress(selectedMultisig.creator)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Members</div>
                    <div className="font-mono text-sm text-[var(--text)]">{selectedMultisig.memberCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Threshold</div>
                    <div className="font-mono text-xs text-[var(--text-secondary)] flex items-center gap-1">
                      <Lock size={10} className="text-[var(--text)]" /> encrypted
                    </div>
                  </div>
                </div>

                {account?.toLowerCase() === selectedMultisig.creator.toLowerCase() && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setModalView("addMember")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                                 bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                    >
                      <Users size={12} /> Add member
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setModalView("propose")}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                             bg-text from-[var(--text)] to-[var(--text)]
                             text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all"
                >
                  <Send size={14} /> New proposal
                </button>
              </div>

              {/* Proposals */}
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mt-4 mb-2">
                Proposals
              </div>
              {selectedProposals.length === 0 ? (
                <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-6 text-center">
                  <p className="text-xs text-[var(--text-muted)]">No proposals yet for this multisig.</p>
                </div>
              ) : (
                selectedProposals.map((p) => {
                  const style = STATUS_STYLE[p.status];
                  return (
                    <article key={p.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-[var(--text-muted)]">#{p.id}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                            {STATUS_LABEL[p.status]}
                          </span>
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {p.status === 0 ? formatRemaining(p.deadline) : "ended"}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                        Pay <span className="font-mono">{shortAddress(p.recipient)}</span>
                        <span className="ml-2 inline-flex items-center gap-1 text-[var(--text)]">
                          <Lock size={10} /> encrypted amount
                        </span>
                      </div>
                      {p.status === 0 && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => handleVote(selectedMultisig.id, p.id)}
                            className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium
                                       bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                          >
                            <Vote size={11} /> Vote yes (encrypted)
                          </button>
                          <button
                            onClick={() => handleExecute(selectedMultisig.id, p.id)}
                            className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium
                                       bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors"
                          >
                            <CheckCircle2 size={11} /> Execute (FHE.gte check)
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </>
          )}
        </div>
      </section>

      {/* Create / Add Member / Propose modal */}
      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")}
            {...modalProps}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4"
            >
              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="multisig-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Sparkles size={18} className="text-[var(--text)]" /> New multisig
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Token address</label>
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Threshold (encrypted, raw uint64)
                    </label>
                    <input
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      placeholder="100"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                    <p className="text-[10px] text-[var(--text-muted)]">Sum of yes-shares must reach this for execute() to settle.</p>
                  </div>
                  {!initialized && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button
                    onClick={handleCreate}
                    disabled={!initialized || !token || !threshold || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50"
                  >
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    {txState === "signing" ? "Signing…" : txState === "confirming" ? "Confirming…" : "Encrypt & create"}
                  </button>
                </>
              )}

              {modalView === "addMember" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Users size={18} className="text-[var(--text)]" /> Add member
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Member address</label>
                    <input
                      value={memberAddr}
                      onChange={(e) => setMemberAddr(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Voting share (encrypted, raw uint64)
                    </label>
                    <input
                      value={memberShare}
                      onChange={(e) => setMemberShare(e.target.value)}
                      placeholder="50"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <button
                    onClick={handleAddMember}
                    disabled={!initialized || !memberAddr || !memberShare || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50"
                  >
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Users size={14} />}
                    Add member
                  </button>
                </>
              )}

              {modalView === "propose" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Send size={18} className="text-[var(--text)]" /> New proposal
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Recipient</label>
                    <input
                      value={proposalRecipient}
                      onChange={(e) => setProposalRecipient(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Amount (encrypted)
                    </label>
                    <input
                      value={proposalAmount}
                      onChange={(e) => setProposalAmount(e.target.value)}
                      placeholder="500"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Voting duration (seconds)</label>
                    <input
                      value={proposalDuration}
                      onChange={(e) => setProposalDuration(e.target.value)}
                      type="number"
                      min={60}
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]"
                    />
                  </div>
                  <button
                    onClick={handlePropose}
                    disabled={!initialized || !proposalRecipient || !proposalAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50"
                  >
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Send size={14} />}
                    Submit proposal
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
