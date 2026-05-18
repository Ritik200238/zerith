"use client";

/**
 * Confidential Wrapper — /wrapper
 *
 * Wrap any ERC-20 into an encrypted balance. Three flows:
 *  - deposit: public ERC-20 → encrypted internal balance
 *  - transferConfidential: encrypted ↔ encrypted between users
 *  - withdraw (2-step): requestWithdraw → fetch revealed balance via TN →
 *    executeWithdraw with the public amount + signature
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PackageOpen, Plus, X, Loader2, RefreshCw, Lock, ArrowRight,
  CheckCircle2, AlertCircle, Wallet, Send, Eye, ArrowDownToLine,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS, TOKEN_CONFIG } from "@/lib/constants";
import { formatAmount, parseAmount, isValidAddress } from "@/lib/format";

type ModalView = "none" | "deposit" | "transfer" | "withdraw";

export default function WrapperPage() {
  const { account } = useWallet();
  const { initialized } = useCofhe();
  const { encrypt } = useEncrypt();
  const { unseal } = useUnseal();
  const toast = useToast();
  const { decrypt: decryptForTx } = useDecryptForTx();

  const wrapperContract = useContract("ConfidentialWrapper");
  const wrapperRead = useReadContract("ConfidentialWrapper");
  const tokenContract = useContract("ConfidentialToken");

  const deployed =
    CONTRACTS.ConfidentialWrapper !== "0x0000000000000000000000000000000000000000";

  const [tokenAddress, setTokenAddress] = useState(CONTRACTS.ConfidentialToken);
  const [encBalance, setEncBalance] = useState<string | null>(null);
  const [unsealedBalance, setUnsealedBalance] = useState<string | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<string>("0");
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");

  // deposit form
  const [depositAmount, setDepositAmount] = useState("");

  // transfer form
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  // withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawStep, setWithdrawStep] = useState<"idle" | "requesting" | "ready">("idle");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Wrapper", type: "system", href: "/wrapper", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "wrapper-modal-title");

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const fetchData = useCallback(async () => {
    if (!wrapperRead || !account) return;
    try {
      const initialized = await wrapperRead.isInitialized(tokenAddress, account);
      const total = await wrapperRead.totalDeposited(tokenAddress);
      setTotalDeposited(total.toString());

      if (initialized) {
        const handle = await wrapperRead.encBalance(tokenAddress, account);
        setEncBalance(handle.toString());
      } else {
        setEncBalance(null);
        setUnsealedBalance(null);
      }
    } catch {
      /* noop */
    }
  }, [wrapperRead, account, tokenAddress]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchData();
  }, [fetchData, refreshKey, blockTick, deployed]);

  useAccountChangeReset(useCallback(() => {
    setEncBalance(null);
    setUnsealedBalance(null);
    setRefreshKey((k) => k + 1);
  }, []));

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleUnsealBalance = useCallback(async () => {
    if (!encBalance) return;
    const v = await unseal(BigInt(encBalance), 5); // euint64
    if (v !== null) setUnsealedBalance(v.toString());
  }, [encBalance, unseal]);

  const handleDeposit = useCallback(async () => {
    if (!wrapperContract || !tokenContract) return;
    const amount = parseAmount(depositAmount);
    if (amount === null) {
      toast.error("Invalid amount", "Must be a positive number");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      // 1) approve
      const approveTx = await tokenContract.approve(CONTRACTS.ConfidentialWrapper, amount);
      await approveTx.wait();

      // 2) deposit
      const tx = await wrapperContract.deposit(tokenAddress, amount);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setDepositAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Deposit failed", msg);
    }
  }, [wrapperContract, tokenContract, depositAmount, tokenAddress, toast]);

  const handleTransfer = useCallback(async () => {
    if (!wrapperContract || !initialized) return;
    if (!isValidAddress(transferTo)) {
      toast.error("Invalid address", "Must be 0x + 40 hex");
      return;
    }
    const amount = parseAmount(transferAmount);
    if (amount === null) {
      toast.error("Invalid amount", "Positive number");
      return;
    }

    setTxState("signing");
    setTxError(undefined);
    try {
      const { Encryptable } = await import("cofhejs/web");
      const enc = await encrypt([Encryptable.uint64(amount)]);
      if (!enc) throw new Error("Encryption failed");
      const tx = await wrapperContract.transferConfidential(tokenAddress, transferTo, enc[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setTransferTo("");
      setTransferAmount("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Transfer failed", msg);
    }
  }, [wrapperContract, initialized, transferTo, transferAmount, tokenAddress, encrypt, toast]);

  const handleRequestWithdraw = useCallback(async () => {
    if (!wrapperContract) return;
    setTxState("signing");
    setWithdrawStep("requesting");
    try {
      const tx = await wrapperContract.requestWithdraw(tokenAddress);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setWithdrawStep("ready");
    } catch (err: unknown) {
      setTxState("error");
      setWithdrawStep("idle");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Request withdraw failed", msg);
    }
  }, [wrapperContract, tokenAddress, toast]);

  const handleExecuteWithdraw = useCallback(async () => {
    if (!wrapperContract || !encBalance) return;
    const amount = parseAmount(withdrawAmount);
    if (amount === null) {
      toast.error("Invalid amount", "Positive number");
      return;
    }

    setTxState("decrypting");
    setTxError(undefined);
    try {
      // Get TN-signed reveal of the user's full balance
      const result = await decryptForTx(BigInt(encBalance));
      if (!result) throw new Error("Reveal failed");

      const revealedBalance = BigInt(result.decryptedValue);
      if (amount > revealedBalance) {
        throw new Error(`Amount exceeds revealed balance (${revealedBalance})`);
      }

      setTxState("signing");
      const tx = await wrapperContract.executeWithdraw(
        tokenAddress,
        amount,
        revealedBalance,
        result.signature,
      );
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setWithdrawAmount("");
      setWithdrawStep("idle");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Withdraw failed", msg);
    }
  }, [wrapperContract, encBalance, withdrawAmount, tokenAddress, decryptForTx, toast]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Confidential Wrapper" shipDate="Wave 4 deploy" />
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
          — FHERC20 wrapper
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Wrap any ERC-20.{" "}<em className="font-serif italic font-normal">Confidentially</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Wrap any ERC-20 into its encrypted counterpart. Balances and transfer amounts hidden. Unwrap when you want public state back.
            </p>
          </div>
        <div className="flex items-center gap-2">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      {/* Token selector */}
      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4 mt-6">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
          Wrapped token
        </div>
        <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
        <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
          Default = CipherDEX&apos;s {TOKEN_CONFIG.symbol} token. Paste any other ERC-20 address to wrap it.
        </p>
      </section>

      {/* My balance */}
      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Your encrypted balance
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">
            Total wrapped: <span className="font-mono text-[var(--text)]">{formatAmount(totalDeposited)} {TOKEN_CONFIG.symbol}</span>
          </span>
        </div>
        {!account ? (
          <p className="text-sm text-[var(--text-muted)]">Connect wallet to see your balance.</p>
        ) : !encBalance ? (
          <div className="text-sm text-[var(--text-secondary)]">
            <Lock size={14} className="inline text-[var(--text)] mr-1" />
            Not yet deposited. Click <b>Deposit</b> below.
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-mono text-[var(--text)]">
                {unsealedBalance !== null ? formatAmount(unsealedBalance) : "•••"}
                <span className="text-sm text-[var(--text-muted)] ml-2">{TOKEN_CONFIG.symbol}</span>
              </div>
              {unsealedBalance === null && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                  <Lock size={11} className="text-[var(--text)]" /> encrypted on-chain
                </p>
              )}
            </div>
            {unsealedBalance === null ? (
              <button onClick={handleUnsealBalance}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
                <Eye size={12} /> Reveal to me
              </button>
            ) : (
              <button onClick={() => setUnsealedBalance(null)}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Hide
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={() => setModalView("deposit")} disabled={!account}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                       bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors disabled:opacity-40">
            <Plus size={12} /> Deposit (public → encrypted)
          </button>
          <button onClick={() => setModalView("transfer")} disabled={!account || !encBalance}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                       bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors disabled:opacity-40">
            <Send size={12} /> Transfer privately
          </button>
          <button onClick={() => setModalView("withdraw")} disabled={!account || !encBalance}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                       bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors disabled:opacity-40">
            <ArrowDownToLine size={12} /> Withdraw (encrypted → public)
          </button>
        </div>
      </section>

      {/* Modal */}
      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-md p-5 space-y-4">

              {modalView === "deposit" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="wrapper-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Plus size={18} className="text-[var(--text)]" /> Deposit
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Amount</label>
                    <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="100"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                    <p className="text-[10px] text-[var(--text-muted)]">Public on the way in. Encrypted once inside the wrapper.</p>
                  </div>
                  <button onClick={handleDeposit} disabled={!depositAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Wallet size={14} />}
                    Approve & deposit
                  </button>
                </>
              )}

              {modalView === "transfer" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Send size={18} className="text-[var(--text)]" /> Confidential transfer
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Recipient</label>
                    <input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1">
                      <Lock size={11} className="text-[var(--text)]" /> Amount (encrypted)
                    </label>
                    <input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="50"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  {!initialized && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[var(--text-muted)]">Initializing FHE encryption…</span>
                    </div>
                  )}
                  <button onClick={handleTransfer} disabled={!initialized || !transferTo || !transferAmount || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Send size={14} />}
                    Encrypt & send
                  </button>
                </>
              )}

              {modalView === "withdraw" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <ArrowDownToLine size={18} className="text-[var(--text-muted)]" /> Withdraw
                    </h3>
                    <button onClick={() => { setModalView("none"); setWithdrawStep("idle"); }} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>

                  {withdrawStep === "idle" && (
                    <>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Withdraw is a 2-step flow. Step 1: open your encrypted balance for a Threshold Network reveal.
                      </p>
                      <button onClick={handleRequestWithdraw} disabled={txState === "signing" || txState === "confirming"}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                        {txState === "signing" || txState === "confirming"
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Eye size={14} />}
                        Step 1 — Request reveal
                      </button>
                    </>
                  )}

                  {withdrawStep === "requesting" && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                      <Loader2 size={14} className="text-[var(--text-muted)] animate-spin shrink-0" />
                      <span className="text-[var(--text-muted)]">Requesting reveal — confirming on-chain…</span>
                    </div>
                  )}

                  {withdrawStep === "ready" && (
                    <>
                      <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 flex items-center gap-2 text-xs">
                        <CheckCircle2 size={14} className="text-[var(--text)] shrink-0" />
                        <span className="text-[var(--text)]">Reveal opened. Now enter the public withdraw amount.</span>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-[var(--text-muted)] font-medium">Amount to withdraw (public)</label>
                        <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="50"
                          className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                        <p className="text-[10px] text-[var(--text-muted)]">Must be ≤ your revealed encrypted balance.</p>
                      </div>
                      <button onClick={handleExecuteWithdraw} disabled={!withdrawAmount || txState === "decrypting" || txState === "signing" || txState === "confirming"}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                        {txState === "decrypting" || txState === "signing" || txState === "confirming"
                          ? <Loader2 size={14} className="animate-spin" />
                          : <ArrowDownToLine size={14} />}
                        Step 2 — Execute withdraw
                      </button>
                    </>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy explainer */}
      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4 mt-6">
        <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3 flex items-center gap-1.5">
          <Lock size={12} className="text-[var(--text)]" /> Privacy stage
        </h3>
        <div className="grid md:grid-cols-3 gap-3 text-xs">
          <div className="rounded bg-[var(--bg-alt)]/40 p-3">
            <div className="flex items-center gap-1.5 text-[var(--text)] font-semibold mb-1">
              <ArrowRight size={11} /> Deposit
            </div>
            <p className="text-[var(--text-muted)]">Public ERC-20 in. Internal balance encrypted from now on.</p>
          </div>
          <div className="rounded bg-[var(--bg-alt)]/40 p-3">
            <div className="flex items-center gap-1.5 text-[var(--text)] font-semibold mb-1">
              <Send size={11} /> Transfer
            </div>
            <p className="text-[var(--text-muted)]">Stage-3 — encrypted amount, encrypted balance updates. Zero leak.</p>
          </div>
          <div className="rounded bg-[var(--bg-alt)]/40 p-3">
            <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-semibold mb-1">
              <ArrowDownToLine size={11} /> Withdraw
            </div>
            <p className="text-[var(--text-muted)]">2-step. TN signs reveal, then you withdraw a public amount.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
