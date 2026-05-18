"use client";

export const dynamic = "force-dynamic";

/**
 * Organization — /org
 *
 * DAO primitive. Encrypted member voting weights, encrypted vote tallies,
 * threshold-network signed reveal of yes/no totals.
 *
 * Flow: Create org → Add members with encrypted weights → Propose →
 * Vote (encrypted weight added to yes or no) → Request reveal → Publish
 * reveal (TN sig) → Mark executed (off-chain action ran).
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Plus, X, Loader2, RefreshCw, Lock, Users, Vote,
  CheckCircle2, AlertCircle, Send, Eye, ThumbsUp, ThumbsDown, Hammer,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { parseAmount, isValidAddress, shortAddress, formatRemaining } from "@/lib/format";

interface OrgData {
  id: number;
  name: string;
  admin: string;
  memberCount: number;
  proposalCount: number;
  createdAt: number;
  exists: boolean;
}

interface ProposalData {
  id: number;
  orgId: number;
  proposer: string;
  description: string;
  actionHash: string;
  createdAt: number;
  deadline: number;
  status: number; // 0 PENDING 1 REVEAL_REQUESTED 2 APPROVED 3 REJECTED 4 EXECUTED
  revealed: boolean;
  revealedYes: number;
  revealedNo: number;
}

const STATUS_LABEL: Record<number, string> = {
  0: "VOTING", 1: "REVEAL PENDING", 2: "APPROVED", 3: "REJECTED", 4: "EXECUTED",
};
const STATUS_STYLE: Record<number, { bg: string; text: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  2: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]" },
  3: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]" },
  4: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]" },
};

const ROLE_LABEL: Record<number, string> = { 0: "—", 1: "MEMBER", 2: "ADMIN" };

type ModalView = "none" | "create" | "addMember" | "propose";

export default function OrgPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const toast = useToast();
  const { decrypt: decryptForTx } = useDecryptForTx();

  const orgContract = useContract("Organization");
  const orgRead = useReadContract("Organization");

  const deployed =
    CONTRACTS.Organization !== "0x0000000000000000000000000000000000000000";

  const [orgs, setOrgs] = useState<OrgData[]>([]);
  const [proposals, setProposals] = useState<Record<number, ProposalData[]>>({});
  const [myRole, setMyRole] = useState<Record<number, number>>({});
  const [selectedOrg, setSelectedOrg] = useState<OrgData | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");

  // create form
  const [name, setName] = useState("");

  // add member form
  const [memberAddr, setMemberAddr] = useState("");
  const [memberWeight, setMemberWeight] = useState("");

  // propose form
  const [propDescription, setPropDescription] = useState("");
  const [propActionLabel, setPropActionLabel] = useState(""); // becomes actionHash via keccak
  const [propDuration, setPropDuration] = useState("3600");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Organization", type: "system", href: "/org", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "org-modal-title");

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchOrgs = useCallback(async () => {
    if (!orgRead) return;
    try {
      const count = Number(await orgRead.getOrgCount());
      const out: OrgData[] = [];
      const roles: Record<number, number> = {};
      for (let i = 1; i <= count; i++) {
        try {
          const o = await orgRead.orgs(i);
          out.push({
            id: i,
            name: o.name,
            admin: o.admin,
            memberCount: Number(o.memberCount),
            proposalCount: Number(o.proposalCount),
            createdAt: Number(o.createdAt),
            exists: o.exists,
          });
          if (account) {
            try {
              const r = await orgRead.getRole(i, account);
              roles[i] = Number(r);
            } catch {
              roles[i] = 0;
            }
          }
        } catch {
          /* skip */
        }
      }
      setOrgs(out.reverse());
      setMyRole(roles);

      if (selectedOrg) {
        try {
          const propCount = Number(await orgRead.getProposalCount(selectedOrg.id));
          const props: ProposalData[] = [];
          for (let p = 1; p <= propCount; p++) {
            try {
              const pr = await orgRead.proposals(selectedOrg.id, p);
              props.push({
                id: p,
                orgId: selectedOrg.id,
                proposer: pr.proposer,
                description: pr.description,
                actionHash: pr.actionHash,
                createdAt: Number(pr.createdAt),
                deadline: Number(pr.deadline),
                status: Number(pr.status),
                revealed: pr.revealed,
                revealedYes: Number(pr.revealedYes),
                revealedNo: Number(pr.revealedNo),
              });
            } catch {
              /* skip */
            }
          }
          setProposals((prev) => ({ ...prev, [selectedOrg.id]: props.reverse() }));
        } catch {
          /* noop */
        }
      }
    } catch {
      /* noop */
    }
  }, [orgRead, account, selectedOrg]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchOrgs();
  }, [fetchOrgs, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => {
    setSelectedOrg(null);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleCreate = useCallback(async () => {
    if (!orgContract) return;
    if (!name || name.length > 64) {
      toast.error("Invalid name", "1-64 characters required");
      return;
    }
    setTxState("signing");
    setTxError(undefined);
    try {
      const tx = await orgContract.createOrg(name);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setName("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Create failed", msg);
    }
  }, [orgContract, name, toast]);

  const handleAddMember = useCallback(async () => {
    if (!orgContract || !initialized || !selectedOrg) return;
    if (!isValidAddress(memberAddr)) {
      toast.error("Invalid address", "Must be 0x + 40 hex");
      return;
    }
    const weightBn = parseAmount(memberWeight, 0); // raw uint64
    if (weightBn === null) {
      toast.error("Invalid weight", "Positive number");
      return;
    }
    setTxState("signing");
    try {
      const { Encryptable } = await import("cofhejs/web");
      const enc = await encrypt([Encryptable.uint64(weightBn)]);
      if (!enc) throw new Error("Encryption failed");
      const tx = await orgContract.addMember(selectedOrg.id, memberAddr, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setMemberAddr("");
      setMemberWeight("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Add member failed", msg);
    }
  }, [orgContract, initialized, selectedOrg, memberAddr, memberWeight, encrypt, toast]);

  const handlePropose = useCallback(async () => {
    if (!orgContract || !selectedOrg) return;
    if (!propDescription || propDescription.length > 200) {
      toast.error("Invalid description", "1-200 characters");
      return;
    }
    if (!propActionLabel) {
      toast.error("Action label required", "Provide a label that we'll hash for verifiability");
      return;
    }
    const dur = Number(propDuration);
    if (!Number.isFinite(dur) || dur < 60) {
      toast.error("Invalid duration", "≥ 60 seconds");
      return;
    }
    const actionHash = ethers.keccak256(ethers.toUtf8Bytes(propActionLabel));

    setTxState("signing");
    try {
      const tx = await orgContract.createProposal(selectedOrg.id, propDescription, actionHash, BigInt(dur));
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setPropDescription("");
      setPropActionLabel("");
      setPropDuration("3600");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Propose failed", msg);
    }
  }, [orgContract, selectedOrg, propDescription, propActionLabel, propDuration, toast]);

  const handleVote = useCallback(
    async (orgId: number, proposalId: number, support: boolean) => {
      if (!orgContract) return;
      setTxState("signing");
      try {
        const tx = await orgContract.vote(orgId, proposalId, support);
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
    [orgContract, toast],
  );

  const handleRequestReveal = useCallback(
    async (orgId: number, proposalId: number) => {
      if (!orgContract) return;
      setTxState("signing");
      try {
        const tx = await orgContract.requestReveal(orgId, proposalId);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Reveal request failed", msg);
      }
    },
    [orgContract, toast],
  );

  const handlePublishReveal = useCallback(
    async (p: ProposalData) => {
      if (!orgContract || !orgRead) return;
      setTxState("decrypting");
      try {
        const proposal = await orgRead.proposals(p.orgId, p.id);
        const yesHandle = BigInt(proposal.yesWeight);
        const noHandle = BigInt(proposal.noWeight);

        const yesResult = await decryptForTx(yesHandle);
        if (!yesResult) throw new Error("Failed to fetch yes-weight signature");
        const noResult = await decryptForTx(noHandle);
        if (!noResult) throw new Error("Failed to fetch no-weight signature");

        setTxState("signing");
        const tx = await orgContract.publishReveal(
          p.orgId,
          p.id,
          BigInt(yesResult.decryptedValue),
          yesResult.signature,
          BigInt(noResult.decryptedValue),
          noResult.signature,
        );
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Publish reveal failed", msg);
      }
    },
    [orgContract, orgRead, decryptForTx, toast],
  );

  const handleMarkExecuted = useCallback(
    async (orgId: number, proposalId: number) => {
      if (!orgContract) return;
      setTxState("signing");
      try {
        const tx = await orgContract.markExecuted(orgId, proposalId);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Mark executed failed", msg);
      }
    },
    [orgContract, toast],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Organization" shipDate="Wave 4 deploy" />
      </main>
    );
  }

  const selectedProposals = selectedOrg ? (proposals[selectedOrg.id] || []) : [];
  const selectedRole = selectedOrg ? (myRole[selectedOrg.id] || 0) : 0;
  const isSelectedAdmin = selectedOrg && account?.toLowerCase() === selectedOrg.admin.toLowerCase();

  return (
    <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <header className="mb-10 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Organisations
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Treasury on FHE.{" "}<em className="font-serif italic font-normal">Quorum without leaks</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Multi-sig treasuries with encrypted balances. Members vote on encrypted proposals — no one sees the numbers but the org.
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
            <Plus size={14} /> New org
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="grid md:grid-cols-3 gap-4 mt-6">
        {/* Org list */}
        <aside className="space-y-3 md:col-span-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-1.5">
            <Building2 size={12} /> Organizations
          </div>
          {orgs.length === 0 ? (
            <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 text-center">
              <Building2 size={22} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-xs text-[var(--text-secondary)]">No orgs yet</p>
            </div>
          ) : (
            orgs.map((o) => (
              <button key={o.id} onClick={() => setSelectedOrg(o)}
                className={`w-full text-left bg-white border border-dashed border-[var(--border-dash)] rounded p-3 transition-colors hover:bg-bgCard ${
                  selectedOrg?.id === o.id ? "ring-1 ring-[var(--text)]" : ""
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--text)] truncate">{o.name}</span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">#{o.id}</span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {o.memberCount} members · {o.proposalCount} proposals
                </div>
                {myRole[o.id] !== undefined && myRole[o.id] > 0 && (
                  <span className="mt-1 inline-block text-[10px] text-[var(--text)]">
                    you: {ROLE_LABEL[myRole[o.id]]}
                  </span>
                )}
              </button>
            ))
          )}
        </aside>

        {/* Detail */}
        <div className="md:col-span-2 space-y-3">
          {!selectedOrg ? (
            <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
              <Vote size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-secondary)]">Pick an org from the left</p>
            </div>
          ) : (
            <>
              <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Organization</div>
                    <div className="text-base font-semibold text-[var(--text)]">{selectedOrg.name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Admin</div>
                    <div className="font-mono text-xs text-[var(--text-secondary)]">{shortAddress(selectedOrg.admin)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Members</div>
                    <div className="font-mono text-sm text-[var(--text)]">{selectedOrg.memberCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Your role</div>
                    <div className="text-xs text-[var(--text)] font-semibold">{ROLE_LABEL[selectedRole]}</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {isSelectedAdmin && (
                    <button onClick={() => setModalView("addMember")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Users size={12} /> Add member
                    </button>
                  )}
                  {selectedRole > 0 && (
                    <button onClick={() => setModalView("propose")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Send size={12} /> New proposal
                    </button>
                  )}
                </div>
              </div>

              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mt-4 mb-2">
                Proposals
              </div>
              {selectedProposals.length === 0 ? (
                <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-6 text-center">
                  <p className="text-xs text-[var(--text-muted)]">No proposals yet.</p>
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
                          <span className="text-[10px] text-[var(--text-muted)]">by {shortAddress(p.proposer)}</span>
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {p.status === 0 ? formatRemaining(p.deadline) : "ended"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text)]">{p.description}</p>
                      <div className="mt-1 text-[10px] font-mono text-[var(--text-muted)] truncate">
                        action: {p.actionHash.slice(0, 14)}…
                      </div>
                      {p.revealed && (
                        <div className="mt-2 text-[11px] text-[var(--text-secondary)] flex items-center gap-3">
                          <span className="flex items-center gap-1 text-[var(--text)]">
                            <ThumbsUp size={11} /> {p.revealedYes}
                          </span>
                          <span className="flex items-center gap-1 text-[var(--text-muted)]">
                            <ThumbsDown size={11} /> {p.revealedNo}
                          </span>
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {p.status === 0 && selectedRole > 0 && (
                          <>
                            <button onClick={() => handleVote(selectedOrg.id, p.id, true)}
                              className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                              <ThumbsUp size={11} /> Vote yes
                            </button>
                            <button onClick={() => handleVote(selectedOrg.id, p.id, false)}
                              className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                              <ThumbsDown size={11} /> Vote no
                            </button>
                          </>
                        )}
                        {p.status === 0 && isSelectedAdmin && p.deadline < Math.floor(Date.now() / 1000) && (
                          <button onClick={() => handleRequestReveal(selectedOrg.id, p.id)}
                            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                            <Eye size={11} /> Request reveal
                          </button>
                        )}
                        {p.status === 1 && (
                          <button onClick={() => handlePublishReveal(p)}
                            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                            <Lock size={11} /> Publish TN reveal
                          </button>
                        )}
                        {p.status === 2 && isSelectedAdmin && (
                          <button onClick={() => handleMarkExecuted(selectedOrg.id, p.id)}
                            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                            <Hammer size={11} /> Mark executed
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </>
          )}
        </div>
      </section>

      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4">

              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="org-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Building2 size={18} className="text-[var(--text)]" /> New organization
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Treasury"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleCreate} disabled={!name || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    {txState === "signing" ? "Signing…" : txState === "confirming" ? "Confirming…" : "Create"}
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
                    <input value={memberAddr} onChange={(e) => setMemberAddr(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Voting weight (encrypted)
                    </label>
                    <input value={memberWeight} onChange={(e) => setMemberWeight(e.target.value)} placeholder="100"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  {!initialized && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button onClick={handleAddMember} disabled={!initialized || !memberAddr || !memberWeight || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Users size={14} />}
                    Encrypt & add
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
                    <label className="text-xs text-[var(--text-muted)] font-medium">Description</label>
                    <input value={propDescription} onChange={(e) => setPropDescription(e.target.value)} placeholder="Approve Q3 marketing budget"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Action label (will be hashed)</label>
                    <input value={propActionLabel} onChange={(e) => setPropActionLabel(e.target.value)} placeholder="budget-q3-spec-v1"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    <p className="text-[10px] text-[var(--text-muted)]">keccak256 of this becomes the on-chain action hash. Off-chain executor watches for it.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Voting duration (seconds)</label>
                    <input value={propDuration} onChange={(e) => setPropDuration(e.target.value)} type="number" min={60}
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handlePropose} disabled={!propDescription || !propActionLabel || !propDuration || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
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
