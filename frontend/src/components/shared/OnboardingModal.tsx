"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  X, Shield, ArrowRight, Eye, Rocket, Wallet, Coins,
  CheckCircle2, Loader2, Gavel, Send, ArrowLeftRight,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useContract } from "@/hooks/useContract";
import { useToast } from "@/components/shared/Toast";

const STORAGE_KEY = "zerith-onboarding-seen-v2";

type StepKey = "welcome" | "fhe" | "connect" | "faucet" | "path";

const STEPS: StepKey[] = ["welcome", "fhe", "connect", "faucet", "path"];

const PRIMARY_PATH = { label: "Continue to Treasury", href: "/treasury" };
const FEATURE_PATHS = [
  { icon: Send, label: "Encrypted Payroll", href: "/payments" },
  { icon: Gavel, label: "Sealed Auction", href: "/auctions" },
  { icon: ArrowLeftRight, label: "OTC Desk", href: "/otc" },
];

/**
 * 5-screen interactive onboarding (~60s). Issues real txs:
 *  - screen 3 wallet connect
 *  - screen 4 fires the faucet contract (first hands-on FHE op)
 *  - screen 5 routes to the picked feature
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
    // QA / screenshot escape: ?noOnboarding=1 skips the modal so we can
    // capture page contents in screenshot tooling that runs a fresh browser.
    try {
      if (
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("noOnboarding") === "1"
      ) {
        setVisible(false);
      }
    } catch {
      // noop
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
      toast.success("Test tokens received", "1,000 CDEX minted to your wallet");
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
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: "rgba(17, 17, 17, 0.45)", backdropFilter: "blur(6px)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="w-full max-w-lg overflow-hidden"
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
            boxShadow: "0 1px 0 var(--border), 0 24px 60px rgba(17, 17, 17, 0.08)",
          }}
        >
          {/* Progress bar */}
          <div style={{ height: 2, background: "var(--bg-alt)" }}>
            <div
              style={{
                height: "100%",
                width: `${((stepIndex + 1) / totalSteps) * 100}%`,
                background: "var(--text)",
                transition: "width 0.5s var(--ease)",
              }}
            />
          </div>

          {/* Top bar with step indicator + dismiss */}
          <div
            className="flex items-center justify-between px-6 pt-4"
            style={{ borderBottom: "1px dashed var(--border-dash)", paddingBottom: 12 }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              <span style={{ opacity: 0.5 }}>— </span>
              Step {stepIndex + 1} of {totalSteps} · ~60s
            </span>
            <button
              onClick={dismiss}
              aria-label="Close onboarding"
              className="p-1 transition-colors"
              style={{ color: "var(--text-muted)", borderRadius: 4 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 pb-6 pt-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.22 }}
              >
                {step === "welcome" && <ScreenWelcome />}
                {step === "fhe" && <ScreenFHE />}
                {step === "connect" && (
                  <ScreenConnect
                    account={account}
                    onConnect={handleConnect}
                    isConnecting={connecting}
                  />
                )}
                {step === "faucet" && (
                  <ScreenFaucet state={faucetState} onClaim={handleFaucet} />
                )}
                {step === "path" && <ScreenPath onPick={pickPath} />}
              </motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div
              className="flex items-center justify-between pt-5 mt-5"
              style={{ borderTop: "1px dashed var(--border-dash)" }}
            >
              <button
                onClick={stepIndex === 0 ? dismiss : goBack}
                className="font-mono transition-colors"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  padding: "8px 0",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
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
                  className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {stepIndex === totalSteps - 1 ? "Get Started" : "Next"}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ─── Screens ────────────────────────────────────────────────── */

function ScreenIcon({ Icon }: { Icon: React.ComponentType<{ size?: number }> }) {
  // Editorial icon thumbnail — dashed square, neutral, no gradient.
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 44,
        height: 44,
        border: "1px dashed var(--border-dash)",
        borderRadius: "var(--radius)",
        background: "var(--bg-alt)",
        color: "var(--text)",
      }}
    >
      <Icon size={18} />
    </div>
  );
}

function ScreenWelcome() {
  return (
    <div className="space-y-4">
      <ScreenIcon Icon={Shield} />
      <div>
        <h2
          id="onboarding-title"
          className="font-display font-bold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1.2,
          }}
        >
          Welcome to Zer
          <em className="font-serif italic font-normal">ith</em>
        </h2>
        <p
          className="mt-1.5"
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          Encrypted block sales for token foundations.
        </p>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 }}>
        Sealed bids, fair clearing, losing prices encrypted forever. Same
        FHE stack powers encrypted payroll, OTC, and treasury — listed
        under More once you&apos;re in.
      </p>
      <div
        className="p-3 font-mono"
        style={{
          background: "var(--bg-alt)",
          border: "1px dashed var(--border-dash)",
          borderRadius: "var(--radius)",
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: "0.02em",
        }}
      >
        Takes 60 seconds — connect wallet, claim test tokens, pick your first feature.
      </div>
    </div>
  );
}

function ScreenFHE() {
  return (
    <div className="space-y-4">
      <ScreenIcon Icon={Eye} />
      <div>
        <h2
          className="font-display font-bold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1.2,
          }}
        >
          How <em className="font-serif italic font-normal">FHE</em> works
        </h2>
        <p
          className="mt-1.5"
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          Math without identity. Thirty seconds.
        </p>
      </div>
      <ol className="space-y-3">
        {[
          { n: "01", title: "Encrypt locally.", body: "Your value gets encrypted in the browser before it leaves." },
          { n: "02", title: "Compute on ciphertext.", body: "Contracts run gt / lt / add / select on the encrypted data — no decrypt." },
          { n: "03", title: "Reveal only the result.", body: "Threshold Network signs the answer. Inputs stay sealed forever." },
        ].map((s) => (
          <li key={s.n} className="flex gap-4">
            <span
              className="font-mono shrink-0"
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                color: "var(--text-muted)",
                paddingTop: 2,
              }}
            >
              {s.n}
            </span>
            <span style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              <strong style={{ color: "var(--text)" }}>{s.title}</strong> {s.body}
            </span>
          </li>
        ))}
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
      <ScreenIcon Icon={Wallet} />
      <div>
        <h2
          className="font-display font-bold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1.2,
          }}
        >
          Connect your wallet
        </h2>
        <p
          className="mt-1.5"
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          MetaMask on Ethereum Sepolia. We never custody anything.
        </p>
      </div>

      {account ? (
        <div
          className="p-3 flex items-center gap-3"
          style={{
            background: "var(--success-bg)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
          }}
        >
          <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
          <div>
            <p style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>Connected</p>
            <p
              className="font-mono"
              style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em" }}
            >
              {account.slice(0, 6)}…{account.slice(-4)}
            </p>
          </div>
        </div>
      ) : (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="btn btn-primary w-full justify-center disabled:opacity-50"
        >
          {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
          <span>{isConnecting ? "Connecting…" : "Connect MetaMask"}</span>
        </button>
      )}

      <p
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}
      >
        Zerith never holds your keys, never sees your private values, and
        never charges custodial fees.
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
      <ScreenIcon Icon={Coins} />
      <div>
        <h2
          className="font-display font-bold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1.2,
          }}
        >
          Claim 1,000 <em className="font-serif italic font-normal">CDEX</em>
        </h2>
        <p
          className="mt-1.5"
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          Test tokens for testnet. One click — confirms in your wallet.
        </p>
      </div>

      {state === "done" ? (
        <div
          className="p-3 flex items-center gap-3"
          style={{
            background: "var(--success-bg)",
            border: "1px dashed var(--border-dash)",
            borderRadius: "var(--radius)",
          }}
        >
          <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
          <div>
            <p style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
              1,000 CDEX minted
            </p>
            <p
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}
            >
              Your first encrypted balance. Visible only to you.
            </p>
          </div>
        </div>
      ) : (
        <button
          onClick={onClaim}
          disabled={state === "pending"}
          className="btn btn-primary w-full justify-center disabled:opacity-50"
        >
          {state === "pending" ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
          <span>
            {state === "pending"
              ? "Confirming…"
              : state === "error"
                ? "Try again"
                : "Claim test tokens"}
          </span>
        </button>
      )}

      <p
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}
      >
        The balance is encrypted on-chain. Only you can read it via a one-time
        permit signature — nobody else.
      </p>
    </div>
  );
}

function ScreenPath({ onPick }: { onPick: (href: string) => void }) {
  return (
    <div className="space-y-4">
      <ScreenIcon Icon={Rocket} />
      <div>
        <h2
          className="font-display font-bold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1.2,
          }}
        >
          You&apos;re <em className="font-serif italic font-normal">ready</em>
        </h2>
        <p
          className="mt-1.5"
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          Drop into the Treasury hub — your encrypted balance, deposits &amp; withdraws,
          and Proof of Reserves in one view.
        </p>
      </div>

      <button
        onClick={() => onPick(PRIMARY_PATH.href)}
        className="btn btn-primary w-full justify-center"
      >
        <Rocket size={14} />
        <span>{PRIMARY_PATH.label}</span>
      </button>

      <div className="space-y-2">
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ opacity: 0.5 }}>— </span>
          Or jump into a feature
        </div>
        <div className="grid grid-cols-3 gap-2">
          {FEATURE_PATHS.map(({ icon: Icon, label, href }) => (
            <button
              key={href}
              onClick={() => onPick(href)}
              className="flex flex-col items-start gap-2 p-3 text-left transition-colors"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
                color: "var(--text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--text-muted)";
                e.currentTarget.style.background = "var(--bg-card-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-dash)";
                e.currentTarget.style.background = "var(--bg-card)";
              }}
            >
              <Icon size={14} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onPick("/")}
        className="w-full font-mono py-2 transition-colors"
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        Just take me to the landing page
      </button>
    </div>
  );
}
