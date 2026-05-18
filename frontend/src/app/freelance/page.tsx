"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase,
  Lock,
  X,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Users,
  Clock,
  Zap,
  Shield,
  Flag,
  ChevronDown,
  Target,
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
import { FaucetButton } from "@/components/shared/FaucetButton";
import {
  SignatureDrawer,
  type SignatureProof,
} from "@/components/shared/SignatureDrawer";
import { CONTRACTS, FHENIX_TESTNET } from "@/lib/constants";
import { parseAmount } from "@/lib/format";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { ethers } from "ethers";

/* ------------------------------------------------------------------ */
/*  Types */
/* ------------------------------------------------------------------ */

interface JobData {
  id: number;
  poster: string;
  title: string;
  escrowAmount: string;
  token: string;
  bidCount: number;
  assignee: string;
  status: number; // 0=OPEN 1=ASSIGNED 2=COMPLETED 3=DISPUTED
  milestoneCount: number;
}

interface MilestoneData {
  description: string;
  percentage: number;
  status: number; // 0=PENDING 1=DELIVERED 2=APPROVED 3=DISPUTED
}

type ModalView = "none" | "post" | "bid" | "detail";

/* ------------------------------------------------------------------ */
/*  Constants */
/* ------------------------------------------------------------------ */

const JOB_STATUS_LABEL: Record<number, string> = {
  0: "OPEN", 1: "ASSIGNED", 2: "COMPLETED", 3: "DISPUTED",
};
const JOB_STATUS_STYLE: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  1: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text)]", border: "border-[var(--border-dash)]" },
  2: { bg: "bg-bgAlt", text: "text-[var(--text-muted)]", border: "border-borderDash" },
  3: { bg: "bg-[var(--bg-alt)]", text: "text-[var(--text-muted)]", border: "border-[var(--border-dash)]" },
};

const MS_STATUS_LABEL: Record<number, string> = {
  0: "Pending", 1: "Delivered", 2: "Approved", 3: "Disputed",
};
const MS_STATUS_COLOR: Record<number, string> = {
  0: "text-[var(--text-muted)]", 1: "text-[var(--text-muted)]", 2: "text-[var(--text)]", 3: "text-[var(--text-muted)]",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ================================================================== */
/*  FreelancePage */
/* ================================================================== */

export default function FreelancePage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const freelanceContract = useContract("FreelanceBidding");
  const freelanceRead = useReadContract("FreelanceBidding");

  /* ---- state ---- */
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  /* ---- modals ---- */
  const [modalView, setModalView] = useState<ModalView>("none");
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);

  /* ---- post job form ---- */
  const [jobTitle, setJobTitle] = useState("");
  const [jobEscrow, setJobEscrow] = useState("");
  const [jobMilestones, setJobMilestones] = useState<{ desc: string; pct: string }[]>([
    { desc: "", pct: "100" },
  ]);

  /* ---- bid form ---- */
  const [bidPrice, setBidPrice] = useState("");

  const { decrypt: decryptForTx } = useDecryptForTx();

  /* ---- tx feedback ---- */
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Freelance", type: "escrow", href: "/freelance", txHash });
  const [txError, setTxError] = useState<string | undefined>();

  /* ---- signature drawer (verifiable reveal proof) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProof, setDrawerProof] = useState<SignatureProof | null>(null);

  const busyRef = useRef<Set<string>>(new Set());
  const deployed =
    CONTRACTS.FreelanceBidding !== "0x0000000000000000000000000000000000000000";

  /* ---------------------------------------------------------------- */
  /*  Fetch jobs */
  /* ---------------------------------------------------------------- */

  const fetchJobs = useCallback(async () => {
    if (!freelanceRead) return;
    setLoading(true);
    try {
      const total = Number(await freelanceRead.getJobCount());
      const list: JobData[] = [];

      for (let i = 0; i < total; i++) {
        const j = await freelanceRead.getJob(i);
        // Contract returns: (client, token, escrowAmount, deadline, bidCount,
        // status, revealedBid, revealedBidder, title, milestoneCount, milestonesApproved)
        list.push({
          id: i,
          poster: j[0],
          token: j[1],
          escrowAmount: j[2].toString(),
          bidCount: Number(j[4]),
          status: Number(j[5]),
          assignee: j[7] as string,
          title: j[8] as string,
          milestoneCount: Number(j[9]),
        });
      }

      list.reverse();
      setJobs(list);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [freelanceRead]);

  const blockTick = useBlockPoll();
  useEffect(() => { fetchJobs(); }, [fetchJobs, refreshKey, blockTick]);

  // Audit fix E1: clear cross-account state on wallet switch
  useAccountChangeReset(useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---- fetch milestones for a job ---- */

  const fetchMilestones = useCallback(async (job: JobData) => {
    if (!freelanceRead) return;
    const ms: MilestoneData[] = [];
    for (let i = 0; i < job.milestoneCount; i++) {
      const m = await freelanceRead.getMilestone(job.id, i);
      ms.push({
        description: m[0],
        percentage: Number(m[1]),
        status: Number(m[2]),
      });
    }
    setMilestones(ms);
  }, [freelanceRead]);

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

  /* ---------------------------------------------------------------- */
  /*  Post job */
  /* ---------------------------------------------------------------- */

  const handlePostJob = useCallback(async () => {
    if (!freelanceContract || !jobTitle || !jobEscrow) return;
    const valid = jobMilestones.filter((m) => m.desc && m.pct);
    if (valid.length === 0) return;

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const escrowBn = parseAmount(jobEscrow);
      if (escrowBn === null) {
        toast.error("Invalid escrow", "Escrow must be a positive number");
        setTxState("idle");
        return;
      }
      // Contract signature: (token, escrowAmount, duration, title, milestoneDescs, milestonePcts)
      // Default duration = 7 days. MIN_DURATION on the contract is 300s.
      const tx = await freelanceContract.postJob(
        CONTRACTS.ConfidentialToken,
        escrowBn,
        BigInt(604800), // 7 days
        jobTitle,
        valid.map((m) => m.desc),
        valid.map((m) => Number(m.pct)),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setJobTitle("");
      setJobEscrow("");
      setJobMilestones([{ desc: "", pct: "100" }]);
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [freelanceContract, jobTitle, jobEscrow, jobMilestones]);

  /* ---------------------------------------------------------------- */
  /*  Submit bid */
  /* ---------------------------------------------------------------- */

  const handleBid = useCallback(async () => {
    if (!freelanceContract || !initialized || !selectedJob || !bidPrice) return;
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const bidBn = parseAmount(bidPrice);
      if (bidBn === null) {
        toast.error("Invalid bid", "Bid must be a positive number");
        setTxState("idle");
        return;
      }
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint128(bidBn)]);
      if (!enc) throw new Error("Encryption failed");

      const tx = await freelanceContract.submitBid(selectedJob.id, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setBidPrice("");
      setModalView("none");
      setSelectedJob(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [freelanceContract, initialized, selectedJob, bidPrice, encrypt]);

  /* ---- milestone actions ---- */

  const handleDeliver = useCallback(
    (jobId: number, msIdx: number) =>
      guardedAction(`deliver-${jobId}-${msIdx}`, async () => {
        const tx = await freelanceContract!.deliverMilestone(jobId, msIdx);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [freelanceContract, guardedAction],
  );

  const handleApprove = useCallback(
    (jobId: number, msIdx: number) =>
      guardedAction(`approve-${jobId}-${msIdx}`, async () => {
        const tx = await freelanceContract!.approveMilestone(jobId, msIdx);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [freelanceContract, guardedAction],
  );

  const handleDispute = useCallback(
    (jobId: number, msIdx: number) =>
      guardedAction(`dispute-${jobId}-${msIdx}`, async () => {
        const tx = await freelanceContract!.disputeMilestone(jobId, msIdx);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
      }),
    [freelanceContract, guardedAction],
  );

  /**
   * Two-stage settle (audit fix D-FB1):
   * 1. settle(jobId) — marks lowestBid + lowestBidder publicly decryptable
   * 2. fetch TN signatures for both
   * 3. finalizeSettlement(jobId, bidVal, bidSig, bidderAddr, bidderSig)
   */
  const handleSettleJob = useCallback(
    (jobId: number) =>
      guardedAction(`settle-job-${jobId}`, async () => {
        if (!freelanceContract) throw new Error("Freelance contract not ready");

        // Step 1: settle (mark publicly decryptable)
        setTxState("signing");
        const settleTx = await freelanceContract.settle(jobId);
        setTxState("confirming");
        setTxHash(settleTx.hash);
        await settleTx.wait();

        // Step 2: read encrypted handles
        const job = await freelanceContract.jobs(jobId);
        const bidHandle = job.lowestBid as unknown as string;
        const bidderHandle = job.lowestBidder as unknown as string;

        // Step 3: TN signatures
        setTxState("decrypting");
        const bidProof = await decryptForTx(bidHandle);
        if (!bidProof) throw new Error("Bid decryption failed");
        const bidderProof = await decryptForTx(bidderHandle);
        if (!bidderProof) throw new Error("Bidder decryption failed");

        const bidderAddr = ethers.getAddress(
          "0x" + bidderProof.decryptedValue.toString(16).padStart(40, "0"),
        );

        // Step 4: finalize on-chain
        setTxState("signing");
        const finTx = await freelanceContract.finalizeSettlement(
          jobId,
          bidProof.decryptedValue,
          bidProof.signature,
          bidderAddr,
          bidderProof.signature,
        );
        setTxState("confirming");
        setTxHash(finTx.hash);
        await finTx.wait();
        setTxState("success");

        setDrawerProof({
          ctHash: bidHandle,
          decryptedValue: `${bidProof.decryptedValue.toString()} (winning bid)`,
          signature: bidProof.signature,
          txHash: finTx.hash,
          chainId: FHENIX_TESTNET.chainId,
          label: "Lowest freelance bid",
        });
        setDrawerOpen(true);
      }),
    [freelanceContract, guardedAction, decryptForTx],
  );

  /**
   * 3-voter encrypted dispute resolution (audit fix D-FB2).
   * After 3 votes are cast, the voteSum becomes publicly decryptable.
   * Anyone fetches the TN signature for the sum and submits resolveDispute.
   */
  const handleResolveDispute = useCallback(
    (jobId: number, msIdx: number) =>
      guardedAction(`resolve-${jobId}-${msIdx}`, async () => {
        if (!freelanceContract) throw new Error("Freelance contract not ready");

        const ms = await freelanceContract.milestones(jobId, msIdx);
        const voteSumHandle = ms.voteSum as unknown as string;

        setTxState("decrypting");
        const proof = await decryptForTx(voteSumHandle);
        if (!proof) throw new Error("Vote sum decryption failed");

        setTxState("signing");
        const tx = await freelanceContract.resolveDispute(
          jobId,
          msIdx,
          proof.decryptedValue,
          proof.signature,
        );
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");

        const totalVotes = Number(proof.decryptedValue);
        setDrawerProof({
          ctHash: voteSumHandle,
          decryptedValue: `${totalVotes}/3 votes for freelancer (${
            totalVotes >= 2 ? "freelancer wins" : "client wins"
          })`,
          signature: proof.signature,
          txHash: tx.hash,
          chainId: FHENIX_TESTNET.chainId,
          label: "Dispute vote sum",
        });
        setDrawerOpen(true);
      }),
    [freelanceContract, guardedAction, decryptForTx],
  );

  /* ---- helpers ---- */

  const isPoster = (j: JobData) =>
    account !== null && j.poster.toLowerCase() === account.toLowerCase();

  const isAssignee = (j: JobData) =>
    account !== null && j.assignee.toLowerCase() === account.toLowerCase();

  const addMilestone = () => {
    if (jobMilestones.length >= 10) return;
    setJobMilestones((prev) => [...prev, { desc: "", pct: "" }]);
  };

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
          — Freelance bidding
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Sealed bids.{" "}<em className="font-serif italic font-normal">Encrypted disputes</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Post jobs, receive sealed bids, ship in encrypted milestones. Disputes resolved by 3 voters who never see the bid price.
            </p>
          </div>
        <div className="flex items-center gap-3">
          <FaucetButton />
          {account && (
            <button
              onClick={() => {
                setModalView("post");
                setTxState("idle");
              }}
              className="flex items-center gap-2 px-4 py-2 rounded
                         bg-[var(--text)] text-[var(--bg)] text-sm font-medium
                           transition-all"
            >
              <Plus size={16} />
              Post Job
            </button>
          )}
        </div>
      </div></div>
      

      {/* Not connected */}
      {!account && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-10 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded flex items-center justify-center" style={{ background: "var(--text)" }}>
            <Briefcase size={24} style={{ color: "var(--bg)" }} />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Connect your wallet</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Post jobs with milestone escrow, submit encrypted bids, and manage deliverables —
            all with FHE-encrypted pricing.
          </p>
        </div>
      )}

      {/* Not deployed */}
      {account && !deployed && (
        <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 border-[var(--border-dash)] flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--text-muted)]">
              FreelanceBidding contract not deployed yet
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Deploy the contracts and update the address in constants.ts.
            </p>
          </div>
        </div>
      )}

      {/* Info */}
      {account && (
        <div className="flex items-center gap-3 px-4 py-3 rounded bg-[var(--bg-alt)] border border-[var(--border-dash)]">
          <Lock size={16} className="text-[var(--text)] shrink-0" />
          <p className="text-xs text-[var(--text)]/80">
            <strong>Encrypted bidding:</strong> Freelancer bids are encrypted with FHE.
            The poster cannot see bid amounts until they accept. Milestone payments are
            released from escrow upon approval.
          </p>
        </div>
      )}

      {/* Tx / encryption status */}
      <TransactionStatus
        state={txState}
        txHash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />
      <EncryptionProgress stage={stage} visible={encrypting} />

      {/* Toolbar */}
      {account && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">
            {jobs.length} job{jobs.length !== 1 ? "s" : ""}
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

      {/* Job grid */}
      {account && (
        <>
          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-[var(--text)] animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="py-20 text-center space-y-3">
              <Briefcase size={36} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">No jobs posted yet</p>
              <p className="text-xs text-[var(--text-muted)]">
                Post the first job to get started
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {jobs.map((job) => {
                const style = JOB_STATUS_STYLE[job.status] ?? JOB_STATUS_STYLE[0];
                const mine = isPoster(job);

                return (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="overflow-hidden hover:border-[var(--border-dash)] transition-all"
                  >
                    {/* Card header */}
                    <div className="px-5 py-4 border-b border-[var(--border-dash)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--text-muted)]">#{job.id}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
                        >
                          {JOB_STATUS_LABEL[job.status]}
                        </span>
                      </div>
                      {mine && (
                        <span className="text-[10px] text-[var(--text)] bg-[var(--bg-alt)] px-2 py-0.5 rounded">
                          Your Job
                        </span>
                      )}
                    </div>

                    {/* Card body */}
                    <div className="px-5 py-4 space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--text)] leading-snug">
                        {job.title}
                      </h3>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Escrow</p>
                          <p className="text-sm font-bold text-[var(--text)]">
                            {job.escrowAmount}{" "}
                            <span className="text-xs font-medium text-[var(--text)]">CDEX</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--text-muted)]">Milestones</p>
                          <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-1 justify-end">
                            <Target size={12} className="text-[var(--text)]/60" />
                            {job.milestoneCount}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Users size={12} className="text-[var(--text)]/60" />
                          {job.bidCount} bid{job.bidCount !== 1 ? "s" : ""}
                        </div>
                        {job.assignee !== "0x0000000000000000000000000000000000000000" && (
                          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                            <CheckCircle2 size={12} className="text-[var(--text)]/60" />
                            {shortAddr(job.assignee)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                        <Lock size={10} className="text-[var(--text)]/40" />
                        Bid prices encrypted with FHE
                      </div>
                    </div>

                    {/* Card actions */}
                    <div className="px-5 py-3 border-t border-[var(--border-dash)] flex items-center gap-2">
                      {job.status === 0 && !mine && (
                        <button
                          onClick={() => {
                            setSelectedJob(job);
                            setBidPrice("");
                            setModalView("bid");
                            setTxState("idle");
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold
                                     bg-[var(--text)] text-[var(--bg)]
                                       transition-all"
                        >
                          <Lock size={12} />
                          Submit Bid
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          setSelectedJob(job);
                          setModalView("detail");
                          setTxState("idle");
                          await fetchMilestones(job);
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

      {/* ======================== POST JOB MODAL ======================== */}
      <AnimatePresence>
        {modalView === "post" && (
          <motion.div
            key="post-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}
          >
            <motion.div
              key="post-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-lg p-6 space-y-5
                          max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Briefcase size={18} className="text-[var(--text)]" />
                  Post Job
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Job Title</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g., Smart contract audit"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              {/* Escrow */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Escrow Amount (CDEX)</label>
                <input
                  type="number"
                  value={jobEscrow}
                  onChange={(e) => setJobEscrow(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              {/* Milestones */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--text-muted)] font-medium">Milestones</label>
                  <button
                    onClick={addMilestone}
                    className="text-xs text-[var(--text)] hover:text-[var(--text)] transition-colors flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Add
                  </button>
                </div>

                {jobMilestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={m.desc}
                      onChange={(e) => {
                        setJobMilestones((prev) =>
                          prev.map((ms, idx) => (idx === i ? { ...ms, desc: e.target.value } : ms))
                        );
                      }}
                      placeholder={`Milestone ${i + 1} description`}
                      className="flex-1 rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                                 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                                 focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={m.pct}
                        onChange={(e) => {
                          setJobMilestones((prev) =>
                            prev.map((ms, idx) => (idx === i ? { ...ms, pct: e.target.value } : ms))
                          );
                        }}
                        placeholder="%"
                        min="0"
                        max="100"
                        className="w-16 rounded px-2 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                                   text-sm text-[var(--text)] text-center placeholder:text-[var(--text-muted)]
                                   focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                      />
                      <span className="text-xs text-[var(--text-muted)]">%</span>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handlePostJob}
                disabled={txState === "signing" || txState === "confirming"}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-[var(--text)] text-[var(--bg)]
                             transition-all
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {txState === "signing" || txState === "confirming" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Post Job
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== BID MODAL ======================== */}
      <AnimatePresence>
        {modalView === "bid" && selectedJob && (
          <motion.div
            key="bid-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}
          >
            <motion.div
              key="bid-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-6 space-y-5
                         "
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Lock size={18} className="text-[var(--text)]" />
                  Submit Encrypted Bid
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3">
                <p className="text-xs text-[var(--text-muted)]">Job</p>
                <p className="text-sm font-semibold text-[var(--text)]">{selectedJob.title}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Escrow: {selectedJob.escrowAmount} CDEX
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-muted)] font-medium">Your Bid (CDEX)</label>
                <input
                  type="number"
                  value={bidPrice}
                  onChange={(e) => setBidPrice(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full rounded px-3 py-2.5 bg-[var(--bg)] border border-[var(--border-dash)]
                             text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--border-dash)] transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-alt)] border border-[var(--border-dash)]">
                <Shield size={12} className="text-[var(--text)] shrink-0" />
                <p className="text-[10px] text-[var(--text)]/70">
                  Your bid price will be encrypted with FHE. The poster cannot see it until they accept.
                </p>
              </div>

              <button
                onClick={handleBid}
                disabled={txState === "signing" || txState === "confirming" || encrypting || !bidPrice}
                className="w-full flex items-center justify-center gap-2 rounded py-3 text-sm font-semibold
                           bg-[var(--text)] text-[var(--bg)]
                             transition-all
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {encrypting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Encrypting bid...
                  </>
                ) : txState === "signing" || txState === "confirming" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    Submit Encrypted Bid
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== DETAIL MODAL ======================== */}
      <AnimatePresence>
        {modalView === "detail" && selectedJob && (
          <motion.div
            key="detail-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}
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
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <Briefcase size={18} className="text-[var(--text)]" />
                  {selectedJob.title}
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Job info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded bg-[var(--bg-alt)] px-3 py-2">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase">Escrow</p>
                  <p className="text-sm font-bold text-[var(--text)]">{selectedJob.escrowAmount} CDEX</p>
                </div>
                <div className="rounded bg-[var(--bg-alt)] px-3 py-2">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase">Bids</p>
                  <p className="text-sm font-bold text-[var(--text)]">{selectedJob.bidCount}</p>
                </div>
              </div>

              {/* Milestones */}
              <div className="space-y-2">
                <p className="text-xs text-[var(--text-muted)] font-medium">Milestones</p>
                {milestones.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">Loading milestones...</p>
                ) : (
                  milestones.map((ms, i) => (
                    <div
                      key={i}
                      className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] px-4 py-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-[var(--text)]">
                          {i + 1}. {ms.description}
                        </p>
                        <span className={`text-[10px] font-semibold ${MS_STATUS_COLOR[ms.status]}`}>
                          {MS_STATUS_LABEL[ms.status]}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">{ms.percentage}% of escrow</span>
                        <div className="flex items-center gap-1.5">
                          {/* Deliver (assignee, pending) */}
                          {isAssignee(selectedJob) && ms.status === 0 && (
                            <button
                              onClick={() => handleDeliver(selectedJob.id, i)}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-alt)] text-[var(--text)]
                                         hover:bg-[var(--bg-alt)] transition-colors"
                            >
                              Deliver
                            </button>
                          )}
                          {/* Approve (poster, delivered) */}
                          {isPoster(selectedJob) && ms.status === 1 && (
                            <button
                              onClick={() => handleApprove(selectedJob.id, i)}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-alt)] text-[var(--text)]
                                         hover:bg-[var(--bg-alt)] transition-colors"
                            >
                              Approve
                            </button>
                          )}
                          {/* Dispute (poster, delivered) */}
                          {isPoster(selectedJob) && ms.status === 1 && (
                            <button
                              onClick={() => handleDispute(selectedJob.id, i)}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)]
                                         hover:bg-[var(--bg-alt)] transition-colors"
                            >
                              Dispute
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SignatureDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={drawerProof}
      />
    </div>
  );
}
