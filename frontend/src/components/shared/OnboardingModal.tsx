"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  X, Shield, ArrowRight, Eye, Lock, Rocket, Wallet, Coins,
  CheckCircle2, Loader2, Gavel, Send, ArrowLeftRight,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useContract } from "@/hooks/useContract";
import { useToast } from "@/components/shared/Toast";

const STORAGE_KEY = "sigil-onboarding-seen";

type StepKey = "welcome" | "fhe" | "connect" | "faucet" | "path";

const STEPS: StepKey[] = ["welcome", "fhe", "connect", "faucet", "path"];

// Primary landing — Treasury is the v1 hub (live balance + deposit/withdraw + Proof of Reserves).
// Secondary paths let power users jump straight into a feature if they know what they want.
const PRIMARY_PATH = { label: "Continue to Treasury", href: "/treasury" };
const FEATURE_PATHS = [
  { icon: Send, label: "Encrypted Payroll", href: "/payments", color: "text-emerald-400" },
  { icon: Gavel, label: "Sealed Auction", href: "/auctions", color: "text-blue-400" },
  { icon: ArrowLeftRight, label: "OTC Desk", href: "/otc", color: "text-violet-400" },
];

/**
 * Audit fix W4-D1: 5-screen interactive onboarding (60-second target).
 *
 * Replaces the copy-only modal with real txs during onboarding:
 *  - screen 3 triggers wallet connect via WalletProvider
 *  - screen 4 fires the faucet contract
 *  - screen 5 routes to the picked feature
 *
 * Storage key gates re-display. The first encrypted operation
 * (faucet tx) runs during onboarding so the user has hands-on FHE
 * exposure before landing on a feature page.
 */
export function OnboardingModal() {
  const router = useRouter();
  const toast = useToast();
  const { account, connect, connecting } = useWallet();
  const tokenContract = useContract("ConfidentialToken");

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<StepKey>("welcome");
  const [faucetState, setFaucetState] = useState<"idle" | "pending" | "done" | "error">("idle");

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setVisible(true);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // noop
    }
  }, []);

  const stepIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length;

  const goNext = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= totalSteps) {
      dismiss();
    } else {
      setStep(STEPS[nextIdx]);
    }
  }, [stepIndex, totalSteps, dismiss]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  }, [stepIndex]);

  const handleConnect = useCallback(async () => {
    try {
      await connect();
      // advance once we see account on next render
    } catch {
      toast.error("Wallet connect failed", "Please try again or check your wallet");
    }
  }, [connect, toast]);

  const handleFaucet = useCallback(async () => {
    if (!tokenContract || faucetState === "pending") return;
    setFaucetState("pending");
    try {
      const tx = await tokenContract.faucet();
      await tx.wait();
      setFaucetState("done");
      toast.success("Test tokens received", "1,000 SIGIL minted to your wallet");
    } catch (err) {
      setFaucetState("error");
      const isRejection = err instanceof Error && err.message.includes("user rejected");
      toast.error(
        isRejection ? "Faucet cancelled" : "Faucet failed",
        isRejection ? "You can try again any time" : "Network or contract error",
      );
    }
  }, [tokenContract, faucetState, toast]);

  const pickPath = useCallback(
    (href: string) => {
      dismiss();
      router.push(href);
    },
    [dismiss, router],
  );

  // Auto-advance from connect screen once account appears
  useEffect(() => {
    if (step === "connect" && account) {
      const t = setTimeout(() => setStep("faucet"), 600);
      return () => clearTimeout(t);
    }
  }, [step, account]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="glass-elevated rounded-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Progress bar */}
          <div className="h-1 bg-[var(--void-5)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--cipher-violet)] to-[var(--cipher-cyan)] transition-all duration-500"
              style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Top bar with dismiss */}
          <div className="flex items-center justify-between px-5 pt-4">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              {stepIndex + 1} of {totalSteps} · ~60s
            </span>
            <button
              onClick={dismiss}
              aria-label="Close onboarding"
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 pb-6 pt-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.22 }}
              >
                {step === "welcome" && (
                  <ScreenWelcome />
                )}
                {step === "fhe" && (
                  <ScreenFHE />
                )}
                {step === "connect" && (
                  <ScreenConnect
                    account={account}
                    onConnect={handleConnect}
                    isConnecting={connecting}
                  />
                )}
                {step === "faucet" && (
                  <ScreenFaucet
                    state={faucetState}
                    onClaim={handleFaucet}
                  />
                )}
                {step === "path" && (
                  <ScreenPath onPick={pickPath} />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div className="flex items-center justify-between pt-5 mt-1">
              <button
                onClick={stepIndex === 0 ? dismiss : goBack}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {stepIndex === 0 ? "Skip" : "Back"}
              </button>

              {step !== "path" && (
                <button
                  onClick={goNext}
                  disabled={
                    (step === "connect" && !account) ||
                    (step === "faucet" && faucetState === "pending")
                  }
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                             bg-gradient-to-r from-[var(--cipher-violet)] to-[var(--cipher-blue)]
                             text-white hover:shadow-lg hover:shadow-[var(--cipher-violet)]/25
                             transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {stepIndex === totalSteps - 1 ? "Get Started" : "Next"}
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Screens                                                            */
/* ------------------------------------------------------------------ */

function ScreenWelcome() {
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--cipher-violet)] to-[var(--cipher-blue)]
                      flex items-center justify-center shadow-lg">
        <Shield size={22} className="text-white" />
      </div>
      <div>
        <h2 id="onboarding-title" className="text-xl font-bold text-[var(--text-primary)]">
          Welcome to CipherDEX
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          The private operating system for DAOs.
        </p>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        Every payment, bid, trade, and salary on CipherDEX is encrypted on-chain. Smart contracts compute
        on the ciphertext directly — the plaintext never exists publicly.
      </p>
      <div className="rounded-lg bg-[var(--void-4)]/50 p-3 text-xs text-[var(--text-muted)]">
        Takes 60 seconds. You will connect a wallet, claim test tokens, and pick your first feature.
      </div>
    </div>
  );
}

function ScreenFHE() {
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--cipher-cyan)] to-[var(--cipher-green)]
                      flex items-center justify-center shadow-lg">
        <Eye size={22} className="text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          How FHE works in 30 seconds
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Math without identity.
        </p>
      </div>
      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--cipher-violet)]/20 text-[var(--cipher-violet)] text-xs font-bold flex items-center justify-center">1</span>
          <span className="text-[var(--text-secondary)]"><b className="text-[var(--text-primary)]">Encrypt locally.</b> Your value gets encrypted in your browser before it ever leaves.</span>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--cipher-violet)]/20 text-[var(--cipher-violet)] text-xs font-bold flex items-center justify-center">2</span>
          <span className="text-[var(--text-secondary)]"><b className="text-[var(--text-primary)]">Compute on ciphertext.</b> Contracts run gt/lt/add/select on the encrypted data without decrypting.</span>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--cipher-violet)]/20 text-[var(--cipher-violet)] text-xs font-bold flex items-center justify-center">3</span>
          <span className="text-[var(--text-secondary)]"><b className="text-[var(--text-primary)]">Reveal only the result.</b> Threshold Network signs the answer. Inputs stay sealed forever.</span>
        </li>
      </ol>
    </div>
  );
}

function ScreenConnect({
  account,
  onConnect,
  isConnecting,
}: {
  account: string | null;
  onConnect: () => void;
  isConnecting: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--cipher-blue)] to-[var(--cipher-violet)]
                      flex items-center justify-center shadow-lg">
        <Wallet size={22} className="text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Connect your wallet</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          MetaMask on Eth Sepolia. We do not custody anything.
        </p>
      </div>

      {account ? (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-400" />
          <div className="text-sm">
            <p className="text-emerald-300 font-medium">Connected</p>
            <p className="text-[10px] text-[var(--text-muted)] font-mono">{account.slice(0, 6)}…{account.slice(-4)}</p>
          </div>
        </div>
      ) : (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                     bg-gradient-to-r from-[var(--cipher-violet)] to-[var(--cipher-blue)]
                     text-white text-sm font-medium hover:shadow-lg hover:shadow-[var(--cipher-violet)]/25
                     transition-all disabled:opacity-50"
        >
          {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
          {isConnecting ? "Connecting…" : "Connect MetaMask"}
        </button>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        CipherDEX never holds your keys, never sees your private values, and never charges custodial fees.
      </p>
    </div>
  );
}

function ScreenFaucet({
  state,
  onClaim,
}: {
  state: "idle" | "pending" | "done" | "error";
  onClaim: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--cipher-green)] to-[var(--cipher-cyan)]
                      flex items-center justify-center shadow-lg">
        <Coins size={22} className="text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Claim 1,000 SIGIL</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Test tokens for the testnet. One click — confirms in your wallet.
        </p>
      </div>

      {state === "done" ? (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-400" />
          <div className="text-sm">
            <p className="text-emerald-300 font-medium">1,000 SIGIL minted</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Your first encrypted balance. Visible only to you.
            </p>
          </div>
        </div>
      ) : (
        <button
          onClick={onClaim}
          disabled={state === "pending"}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                     bg-gradient-to-r from-[var(--cipher-green)] to-[var(--cipher-cyan)]
                     text-white text-sm font-medium hover:shadow-lg
                     transition-all disabled:opacity-50"
        >
          {state === "pending" ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
          {state === "pending" ? "Confirming…" : state === "error" ? "Try again" : "Claim test tokens"}
        </button>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        These tokens balance is encrypted on-chain. You will see your own value via a one-time
        permit signature — nobody else can read it.
      </p>
    </div>
  );
}

function ScreenPath({ onPick }: { onPick: (href: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--cipher-violet)] to-[var(--cipher-cyan)]
                      flex items-center justify-center shadow-lg">
        <Rocket size={22} className="text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">You&apos;re ready</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Drop into the Treasury hub — your encrypted balance, deposits/withdraws,
          and Proof of Reserves all in one view.
        </p>
      </div>

      {/* Primary CTA — Treasury hub */}
      <button
        onClick={() => onPick(PRIMARY_PATH.href)}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-80"
        style={{ background: "var(--text)", color: "var(--bg)", borderRadius: 8 }}
      >
        <Rocket size={14} /> {PRIMARY_PATH.label}
      </button>

      {/* Secondary — jump straight into a feature if you know what you want */}
      <div className="space-y-2">
        <div
          className="font-mono text-[10px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — or jump into a feature
        </div>
        <div className="grid grid-cols-3 gap-2">
          {FEATURE_PATHS.map(({ icon: Icon, label, href, color }) => (
            <button
              key={href}
              onClick={() => onPick(href)}
              className="rounded-lg bg-[var(--void-4)]/40 hover:bg-[var(--void-4)]/80 border border-[var(--border-subtle)]
                         hover:border-[var(--cipher-violet)]/40 p-3 flex flex-col items-start gap-2
                         transition-all text-left"
            >
              <Icon size={16} className={color} />
              <span className="text-xs font-medium text-[var(--text-primary)] leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onPick("/")}
        className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] py-2 transition-colors"
      >
        Just take me to the landing page
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Decorative — not used directly but referenced in dependency       */
/* ------------------------------------------------------------------ */

const _decor = { Lock };
