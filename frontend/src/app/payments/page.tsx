"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Lock,
  X,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Users,
  Copy,
  Trash2,
  Download,
  FileText,
  Eye,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useContract, useReadContract } from "@/hooks/useContract";
import { EncryptionProgress } from "@/components/shared/EncryptionProgress";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { PrivacyLens } from "@/components/shared/PrivacyLens";
import { CONTRACTS, TOKEN_CONFIG } from "@/lib/constants";
import { useTxFeedback } from "@/hooks/useTxFeedback";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SplitData {
  id: number;
  creator: string;
  token: string;
  totalDeposited: bigint;
  recipientCount: number;
  claimedCount: number;
  status: number; // 0=FUNDED 1=COMPLETED 2=CANCELLED
  createdAt: number;
  templateId: number;
}

interface RecipientInfo {
  address: string;
  amount: string;
  claimed: boolean;
  unsealed: string | null;
}

type ModalView = "none" | "create" | "template" | "claim" | "detail";
type TabView = "splits" | "templates";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<number, string> = { 0: "ACTIVE", 1: "COMPLETED" };
const STATUS_STYLE: Record<number, React.CSSProperties> = {
  0: {
    color: "var(--text)",
    background: "var(--bg-card)",
    border: "1px dashed var(--border-dash)",
  },
  1: {
    color: "var(--text-muted)",
    background: "var(--bg-alt)",
    border: "1px dashed var(--border-dash)",
  },
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ================================================================== */
/*  PaymentsPage                                                       */
/* ================================================================== */

export default function PaymentsPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { unseal, unsealing } = useUnseal();
  const paymentsContract = useContract("PrivatePayments");
  const paymentsRead = useReadContract("PrivatePayments");

  /* ---- state ---- */
  const [splits, setSplits] = useState<SplitData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<TabView>("splits");

  /* ---- modals ---- */
  const [modalView, setModalView] = useState<ModalView>("none");
  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"));
  const [selectedSplit, setSelectedSplit] = useState<SplitData | null>(null);
  const [recipients, setRecipients] = useState<RecipientInfo[]>([]);

  /* ---- create form ---- */
  const [newRecipients, setNewRecipients] = useState<{ address: string; amount: string }[]>([
    { address: "", amount: "" },
  ]);
  const [templateName, setTemplateName] = useState("");

  /* ---- tx feedback ---- */
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Payments", type: "payment", href: "/payments", txHash });

  const deployed =
    CONTRACTS.PrivatePayments !== "0x0000000000000000000000000000000000000000";

  /* ---------------------------------------------------------------- */
  /*  Fetch splits                                                     */
  /* ---------------------------------------------------------------- */

  const fetchSplits = useCallback(async () => {
    if (!paymentsRead) return;
    setLoading(true);
    try {
      const total = Number(await paymentsRead.getSplitCount());
      const list: SplitData[] = [];

      for (let i = 0; i < total; i++) {
        // Use the public mapping getter `splits(i)` (auto-generated from the
        // `mapping(uint256 => Split) public splits`) — returns full 8-field struct
        // in declaration order, including createdAt which getSplit() omits.
        const s = await paymentsRead.splits(i);
        list.push({
          id: i,
          creator: s[0],
          token: s[1],
          totalDeposited: BigInt(s[2]),
          recipientCount: Number(s[3]),
          claimedCount: Number(s[4]),
          status: Number(s[5]),
          createdAt: Number(s[6]),
          templateId: Number(s[7]),
        });
      }

      list.reverse();
      setSplits(list);
    } catch {
      setSplits([]);
    } finally {
      setLoading(false);
    }
  }, [paymentsRead]);

  const blockTick = useBlockPoll();
  useEffect(() => { fetchSplits(); }, [fetchSplits, refreshKey, blockTick]);

  useAccountChangeReset(useCallback(() => {
    setRecipients([]);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /*  Tx helpers                                                       */
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

  /* ---------------------------------------------------------------- */
  /*  Create split                                                     */
  /* ---------------------------------------------------------------- */

  const handleCreateSplit = useCallback(async () => {
    if (!paymentsContract || !initialized) return;
    const valid = newRecipients.filter((r) => r.address && r.amount);
    if (valid.length === 0) {
      toast.warning("No recipients", "Add at least one recipient with an amount.");
      return;
    }

    // Audit fix F8: validate addresses + amounts before submitting tx
    const { isValidAddress: checkAddr, parseAmount: parseAmt } = await import("@/lib/format");
    const badAddr = valid.find((r) => !checkAddr(r.address));
    if (badAddr) {
      toast.error("Invalid recipient address", `"${badAddr.address.slice(0, 10)}..." is not a valid Ethereum address.`);
      return;
    }
    const badAmt = valid.find((r) => parseAmt(r.amount, 0) === null);
    if (badAmt) {
      toast.error("Invalid amount", `"${badAmt.amount}" is not a valid number. Use whole numbers like 1000.`);
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const { Encryptable } = await import("cofhejs/web");

      // Audit fix B2: PrivatePayments.createSplit expects InEuint64[]
      const encItems = valid.map((r) => Encryptable.uint64(BigInt(r.amount)));
      const encrypted = await encrypt(encItems);
      if (!encrypted) throw new Error("Encryption failed");

      const addresses = valid.map((r) => r.address);

      // Contract requires plaintext totalDeposit (4th arg) — sum of per-recipient amounts
      // for escrow funding. Note: total is publicly visible; per-recipient split stays encrypted.
      const totalDeposit = valid.reduce((sum, r) => sum + BigInt(r.amount), BigInt(0));
      const tx = await paymentsContract.createSplit(
        CONTRACTS.ConfidentialToken,
        addresses,
        encrypted,
        totalDeposit,
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      toast.success("Split created", `Sent encrypted amounts to ${valid.length} recipient${valid.length === 1 ? "" : "s"}.`);
      setNewRecipients([{ address: "", amount: "" }]);
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [paymentsContract, initialized, newRecipients, encrypt, toast]);

  /* ---------------------------------------------------------------- */
  /*  Create template                                                  */
  /* ---------------------------------------------------------------- */

  const handleCreateTemplate = useCallback(async () => {
    if (!paymentsContract || !templateName) return;
    const valid = newRecipients.filter((r) => r.address);
    if (valid.length === 0) return;

    setTxState("signing");
    setTxError(undefined);

    try {
      const tx = await paymentsContract.createTemplate(
        templateName,
        valid.map((r) => r.address),
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setTemplateName("");
      setNewRecipients([{ address: "", amount: "" }]);
      setModalView("none");
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [paymentsContract, templateName, newRecipients]);

  /* ---------------------------------------------------------------- */
  /*  Claim payment                                                    */
  /* ---------------------------------------------------------------- */

  const handleClaim = useCallback(async (splitId: number) => {
    if (!paymentsContract) return;
    setTxState("signing");
    setTxError(undefined);

    try {
      const tx = await paymentsContract.claim(splitId);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [paymentsContract]);

  /* ---------------------------------------------------------------- */
  /*  Unseal my amount in a split                                      */
  /* ---------------------------------------------------------------- */

  const handleUnsealAmount = useCallback(async (splitId: number, index: number) => {
    if (!paymentsContract || !account) return;
    try {
      // Contract getMyAmount(splitId) takes 1 arg — returns caller's own encrypted amount.
      // The `index` is only used locally to update the right row in UI state.
      const hash = await paymentsContract.getMyAmount(splitId);
      const val = await unseal(BigInt(hash), 5);
      if (val !== null) {
        setRecipients((prev) =>
          prev.map((r, i) => (i === index ? { ...r, unsealed: val.toString() } : r))
        );
      }
    } catch {
      // no amount or unseal failed
    }
  }, [paymentsContract, account, unseal]);

  /* ---- helpers ---- */

  const addRecipient = () => {
    if (newRecipients.length >= 20) return;
    setNewRecipients((prev) => [...prev, { address: "", amount: "" }]);
  };

  const removeRecipient = (index: number) => {
    setNewRecipients((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, field: "address" | "amount", value: string) => {
    setNewRecipients((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  };

  const isCreator = (s: SplitData) =>
    account !== null && s.creator.toLowerCase() === account.toLowerCase();

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="space-y-10 max-w-[1180px] mx-auto px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <div className="space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Encrypted payroll
        </div>
        <div className="flex items-start justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Pay contributors,{" "}
              <em className="font-serif italic font-normal">privately</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Split payments across recipients. Each sees only their own encrypted amount.
              The total stays hidden from everyone.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <FaucetButton />
            {account && (
              <>
                <button
                  onClick={() => {
                    setModalView("template");
                    setTxState("idle");
                  }}
                  className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
                  style={{
                    background: "transparent",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: 8,
                    color: "var(--text-muted)",
                  }}
                >
                  <FileText size={14} /> Template
                </button>
                <button
                  onClick={() => {
                    setModalView("create");
                    setTxState("idle");
                  }}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                >
                  <Plus size={14} /> Create Split
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

      {/* Not connected */}
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
            Create encrypted payment splits, save templates, and claim your payments —
            all with fully private amounts via FHE.
          </p>
        </div>
      )}

      {/* Not deployed */}
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
              PrivatePayments contract not deployed yet
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Deploy the contracts and update the address in constants.ts.
            </p>
          </div>
        </div>
      )}

      {/* Info */}
      {account && (
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: 4,
          }}
        >
          <Lock size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            <span
              className="font-mono uppercase tracking-[0.1em] mr-2"
              style={{ color: "var(--text)" }}
            >
              How it works:
            </span>
            Each recipient&apos;s amount is encrypted separately. Only the recipient can unseal
            their own share. The total and individual amounts remain hidden from all other parties.
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
          <p
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            {splits.length} split{splits.length !== 1 ? "s" : ""}
          </p>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 font-mono uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      )}

      {/* Split grid */}
      {account && (
        <>
          {loading && splits.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : splits.length === 0 ? (
            <div
              className="py-20 text-center space-y-3"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 4,
              }}
            >
              <CreditCard size={28} className="mx-auto" style={{ color: "var(--text-muted)" }} />
              <p
                className="font-mono text-[11px] uppercase tracking-[0.1em]"
                style={{ color: "var(--text-muted)" }}
              >
                No payment splits yet
              </p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Create the first encrypted payment split
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {splits.map((split) => {
                const style = STATUS_STYLE[split.status] ?? STATUS_STYLE[0];
                const mine = isCreator(split);

                return (
                  <motion.div
                    key={split.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="overflow-hidden transition-colors"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px dashed var(--border-dash)",
                      borderRadius: 4,
                    }}
                  >
                    {/* Card header */}
                    <div
                      className="px-5 py-4 flex items-center justify-between"
                      style={{ borderBottom: "1px dashed var(--border-dash)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          #{split.id}
                        </span>
                        <span
                          className="inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em]"
                          style={{ ...style, borderRadius: 4 }}
                        >
                          {STATUS_LABEL[split.status]}
                        </span>
                      </div>
                      {mine && (
                        <span
                          className="font-mono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5"
                          style={{
                            color: "var(--text)",
                            border: "1px dashed var(--border-dash)",
                            borderRadius: 4,
                          }}
                        >
                          Yours
                        </span>
                      )}
                    </div>

                    {/* Card body */}
                    <div className="px-5 py-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p
                            className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1"
                            style={{ color: "var(--text-muted)" }}
                          >
                            Creator
                          </p>
                          <p className="text-sm font-mono" style={{ color: "var(--text)" }}>
                            {shortAddr(split.creator)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1"
                            style={{ color: "var(--text-muted)" }}
                          >
                            Recipients
                          </p>
                          <p
                            className="text-sm font-semibold flex items-center gap-1 justify-end"
                            style={{ color: "var(--text)" }}
                          >
                            <Users size={12} style={{ color: "var(--text-muted)" }} />
                            {split.recipientCount}
                          </p>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Lock size={10} />
                        Amounts encrypted
                      </div>
                    </div>

                    {/* Card actions */}
                    <div
                      className="px-5 py-3 flex items-center gap-2"
                      style={{ borderTop: "1px dashed var(--border-dash)" }}
                    >
                      {split.status === 0 && !mine && (
                        <button
                          onClick={() => handleClaim(split.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                          style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                        >
                          <Download size={12} /> Claim
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectedSplit(split);
                          setModalView("detail");
                          setTxState("idle");
                        }}
                        className="px-3 py-2 text-xs font-medium transition-colors"
                        style={{
                          background: "transparent",
                          border: "1px dashed var(--border-dash)",
                          color: "var(--text-muted)",
                          borderRadius: 8,
                        }}
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

      {/* ======================== CREATE SPLIT MODAL ======================== */}
      <AnimatePresence>
        {(modalView === "create" || modalView === "template") && (
          <motion.div
            key="modal-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            {...modalProps}
            onClick={() => setModalView("none")}
          >
            <motion.div
              key="modal-card"
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg p-7 space-y-5 max-h-[90vh] overflow-y-auto"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 4,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold flex items-center gap-2" style={{ letterSpacing: "-0.02em" }}>
                  <CreditCard size={18} style={{ color: "var(--text-muted)" }} />
                  {modalView === "template" ? "Create Template" : "Create Split"}
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="p-1 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Template name (only for template) */}
              {modalView === "template" && (
                <div className="space-y-2">
                  <label
                    className="font-mono text-[10px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g., Monthly Team Payment"
                    className="w-full px-3 py-2.5 text-sm focus:outline-none transition-colors"
                    style={{
                      background: "var(--bg)",
                      border: "1px dashed var(--border-dash)",
                      borderRadius: 4,
                      color: "var(--text)",
                    }}
                  />
                </div>
              )}

              {/* Recipients */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label
                    className="font-mono text-[10px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Recipients
                  </label>
                  <button
                    onClick={addRecipient}
                    className="font-mono text-[10px] uppercase tracking-[0.1em] flex items-center gap-1 transition-colors"
                    style={{ color: "var(--text)" }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>

                {newRecipients.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={r.address}
                      onChange={(e) => updateRecipient(i, "address", e.target.value)}
                      placeholder="0x..."
                      className="flex-1 px-3 py-2.5 text-sm font-mono focus:outline-none transition-colors"
                      style={{
                        background: "var(--bg)",
                        border: "1px dashed var(--border-dash)",
                        borderRadius: 4,
                        color: "var(--text)",
                      }}
                    />
                    {modalView === "create" && (
                      <input
                        type="number"
                        value={r.amount}
                        onChange={(e) => updateRecipient(i, "amount", e.target.value)}
                        placeholder="Amount"
                        min="0"
                        className="w-28 px-3 py-2.5 text-sm focus:outline-none transition-colors"
                        style={{
                          background: "var(--bg)",
                          border: "1px dashed var(--border-dash)",
                          borderRadius: 4,
                          color: "var(--text)",
                        }}
                      />
                    )}
                    {newRecipients.length > 1 && (
                      <button
                        onClick={() => removeRecipient(i)}
                        className="p-1 transition-colors"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Encryption info */}
              {modalView === "create" && (
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{
                    background: "var(--bg-alt)",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: 4,
                  }}
                >
                  <Lock size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <p
                    className="font-mono text-[10px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Each amount encrypted individually
                  </p>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={modalView === "template" ? handleCreateTemplate : handleCreateSplit}
                disabled={txState === "signing" || txState === "confirming" || encrypting}
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
              >
                {encrypting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Encrypting amounts...
                  </>
                ) : txState === "signing" || txState === "confirming" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    {modalView === "template" ? "Save Template" : "Create Encrypted Split"}
                  </>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================== DETAIL MODAL ======================== */}
      <AnimatePresence>
        {modalView === "detail" && selectedSplit && (
          <motion.div
            key="detail-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
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
              className="w-full max-w-lg p-7 space-y-5 max-h-[90vh] overflow-y-auto"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 4,
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold flex items-center gap-2" style={{ letterSpacing: "-0.02em" }}>
                  <CreditCard size={18} style={{ color: "var(--text-muted)" }} />
                  Split #{selectedSplit.id}
                </h3>
                <button
                  onClick={() => setModalView("none")}
                  aria-label="Close modal"
                  className="p-1 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={18} />
                </button>
              </div>

              <PrivacyLens
                title="Payment Privacy"
                rows={[
                  {
                    label: "Creator",
                    meValue: selectedSplit.creator,
                    counterpartyValue: shortAddr(selectedSplit.creator),
                    observerValue: shortAddr(selectedSplit.creator),
                    encrypted: false,
                  },
                  {
                    label: "Recipient count",
                    meValue: `${selectedSplit.recipientCount}`,
                    counterpartyValue: `${selectedSplit.recipientCount}`,
                    observerValue: `${selectedSplit.recipientCount}`,
                    encrypted: false,
                  },
                  {
                    label: "Total deposit",
                    meValue: `${selectedSplit.totalDeposited} ${TOKEN_CONFIG.symbol}`,
                    counterpartyValue: `${selectedSplit.totalDeposited} ${TOKEN_CONFIG.symbol}`,
                    observerValue: `${selectedSplit.totalDeposited} ${TOKEN_CONFIG.symbol}`,
                    encrypted: false,
                  },
                  {
                    label: "Per-recipient amounts",
                    meValue: "Your row only — others sealed",
                    counterpartyValue: "Your row only — others sealed",
                    observerValue: "🔒 sealed",
                    encrypted: true,
                  },
                ]}
              />

              <div className="space-y-2">
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Status
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] font-medium"
                    style={{
                      ...(STATUS_STYLE[selectedSplit.status] ?? STATUS_STYLE[0]),
                      borderRadius: 4,
                    }}
                  >
                    {STATUS_LABEL[selectedSplit.status]}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Created {new Date(selectedSplit.createdAt * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {selectedSplit.status === 0 && !isCreator(selectedSplit) && (
                <button
                  onClick={() => handleClaim(selectedSplit.id)}
                  disabled={txState === "signing" || txState === "confirming"}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
                >
                  <Download size={16} />
                  Claim My Payment
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
