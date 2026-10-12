"use client";

export const dynamic = "force-dynamic";

/**
 * Interactive Quickstart — /quickstart
 *
 * Five steps. Each one actually performs the action on click — never
 * a static doc, never a screenshot. Progress persists in localStorage
 * so a returning user picks up exactly where they left off.
 *
 *   ① Connect wallet  — spins up a fresh burner via /api/burner/create
 *   ② Claim faucet    — calls ConfidentialToken.faucet() (1000 CDEX)
 *   ③ Place encrypted bid — picks the most recent OPEN sealed auction,
 *                            encrypts a sample amount, submits a bid
 *   ④ Unseal your bid — fetches your own encrypted bid handle and decrypts
 *                       via your permit (only you can do this)
 *   ⑤ Privacy Lens    — toggle the 3 perspectives (me / counterparty /
 *                       observer) on a sample bid row
 *
 * When all five are done, the page shows a final "You're ready" panel
 * routing to /auctions or /more.
 *
 * Design language matches the rest of the app: dashed borders, em-dash
 * kicker labels, italic-serif accents, JetBrains Mono labels. No
 * marketing fluff — every word is functional.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Coins,
  Lock,
  Eye,
  Sparkles,
  Check,
  Loader2,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  User,
  Users,
  Globe2,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useToast } from "@/components/shared/Toast";
import { humanizeTxError } from "@/hooks/useTxFlow";
import { useCofhe } from "@/hooks/useCofhe";
import { CONTRACTS, FHENIX_TESTNET, TOKEN_CONFIG } from "@/lib/constants";
import { formatAmount, parseAmount } from "@/lib/format";

/* ─── Persistent progress ───────────────────────────────── */

// v2: amounts are stored in 6-decimal base units and progress is per-wallet.
const STORAGE_KEY = "zerith-quickstart-progress-v2";
const SAMPLE_BID_AMOUNT = "100"; // whole CDEX, fixed so the demo is repeatable
// Bids lock funds from the vault, so step 2 deposits this much after the faucet.
const QUICKSTART_DEPOSIT = "500";
const MAX_UINT48 = "281474976710655"; // operator approval that doesn't expire (testnet)

interface Progress {
  /** Wallet this progress belongs to; switching wallets starts over. */
  account: string | null;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  step3AuctionId: number | null;
  step3BidAmount: string | null;
  step3TxHash: string | null;
  step4Done: boolean;
  step4UnsealedAmount: string | null;
  /** The bid's on-chain ciphertext handle — what a public observer sees. */
  step4Handle: string | null;
  step5LensSeen: { me: boolean; counterparty: boolean; observer: boolean };
  step5Done: boolean;
}

const DEFAULT_PROGRESS: Progress = {
  account: null,
  step1Done: false,
  step2Done: false,
  step3Done: false,
  step3AuctionId: null,
  step3BidAmount: null,
  step3TxHash: null,
  step4Done: false,
  step4UnsealedAmount: null,
  step4Handle: null,
  step5LensSeen: { me: false, counterparty: false, observer: false },
  step5Done: false,
};

function loadProgress(): Progress {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return { ...DEFAULT_PROGRESS, ...parsed };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function saveProgress(p: Progress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/* ─── Page ──────────────────────────────────────────────── */

export default function QuickstartPage() {
  const { account, mode, createAndConnectBurner, connecting } = useWallet();
  const { initialized: cofheReady } = useCofhe();
  const { encrypt } = useEncrypt();
  const { unseal } = useUnseal();
  const tokenContract = useContract("ConfidentialToken");
  const vaultContract = useContract("SettlementVault");
  const auctionContract = useContract("SealedAuction");
  const auctionRead = useReadContract("SealedAuction");
  const toast = useToast();

  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [hydrated, setHydrated] = useState(false);

  /* ── Hydrate progress from localStorage on mount ── */
  useEffect(() => {
    setProgress(loadProgress());
    setHydrated(true);
  }, []);

  /* ── Bind progress to the connected wallet (auto-mark step 1) ── */
  useEffect(() => {
    if (!hydrated || !account) return;
    setProgress((prev) => {
      const owner = prev.account?.toLowerCase();
      // A different wallet must not inherit another wallet's bid or decrypted value.
      const base = owner && owner !== account.toLowerCase() ? DEFAULT_PROGRESS : prev;
      if (base === prev && prev.step1Done && prev.account) return prev;
      const next = { ...base, account, step1Done: true };
      saveProgress(next);
      return next;
    });
  }, [account, hydrated]);

  /* ── Tracking states ── */
  const [busyStep, setBusyStep] = useState<1 | 2 | 3 | 4 | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  /* ── Derived: which step is the user actively on? ── */
  const activeStep = useMemo<1 | 2 | 3 | 4 | 5 | "done">(() => {
    if (!progress.step1Done) return 1;
    if (!progress.step2Done) return 2;
    if (!progress.step3Done) return 3;
    if (!progress.step4Done) return 4;
    if (!progress.step5Done) return 5;
    return "done";
  }, [progress]);

  /* ── Step 1: Connect ── */
  const handleStep1 = useCallback(async () => {
    if (account) {
      setProgress((prev) => {
        const next = { ...prev, step1Done: true };
        saveProgress(next);
        return next;
      });
      return;
    }
    setBusyStep(1);
    setStepError(null);
    try {
      await createAndConnectBurner();
      toast.success("Wallet ready", "Created in your browser and topped up with Sepolia gas. You're connected.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create burner";
      setStepError(msg);
      toast.error("Could not create burner", msg);
    } finally {
      setBusyStep(null);
    }
  }, [account, createAndConnectBurner, toast]);

  /* ── Step 2: Faucet + deposit into the vault ── */
  const handleStep2 = useCallback(async () => {
    if (!tokenContract || !vaultContract || !account) {
      toast.error("Wallet not ready", "Finish step 1 first.");
      return;
    }
    if (!cofheReady) {
      toast.error("Not ready yet", "Encryption is still loading — try again in a few seconds.");
      return;
    }
    setBusyStep(2);
    setStepError(null);
    try {
      // 1. Test tokens. The faucet allows one claim per hour; a wallet that already
      //    claimed holds tokens, so skip instead of hitting the cooldown revert.
      const last = Number(await tokenContract.lastFaucetClaim(account));
      if (!(last > 0 && Date.now() / 1000 < last + 3600)) {
        await (await tokenContract.faucet()).wait();
      }

      // 2. One-time approval so the vault can pull tokens for the deposit.
      if (!(await tokenContract.isOperator(account, CONTRACTS.SettlementVault))) {
        await (await tokenContract.setOperator(CONTRACTS.SettlementVault, MAX_UINT48)).wait();
      }

      // 3. Encrypted deposit — bids lock funds from this vault balance.
      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt(
        [Encryptable.uint64(parseAmount(QUICKSTART_DEPOSIT)!)],
        CONTRACTS.SettlementVault,
      );
      if (!enc) throw new Error("Encryption failed");
      await (await vaultContract.deposit(CONTRACTS.ConfidentialToken, enc.handles[0], enc.signature)).wait();

      setProgress((prev) => {
        const next = { ...prev, step2Done: true };
        saveProgress(next);
        return next;
      });
      toast.success(
        `${QUICKSTART_DEPOSIT} ${TOKEN_CONFIG.symbol} deposited`,
        "Your vault balance is encrypted — only you can unseal it.",
      );
    } catch (err) {
      const msg = humanizeTxError(err);
      setStepError(msg);
      toast.error("Couldn't fund your vault", msg);
    } finally {
      setBusyStep(null);
    }
  }, [account, tokenContract, vaultContract, cofheReady, encrypt, toast]);

  /* ── Step 3: Encrypted bid on first OPEN auction ── */
  const handleStep3 = useCallback(async () => {
    if (!auctionRead || !auctionContract || !cofheReady) {
      toast.error(
        "Not ready yet",
        cofheReady ? "Finish step 1 first." : "Encryption WASM still loading…",
      );
      return;
    }
    setBusyStep(3);
    setStepError(null);
    try {
      // Find an OPEN auction (status === 0) with deadline in the future and
      // not seller-by-self. Newest first because that's most likely to be live.
      const total = Number(await auctionRead.getAuctionCount());
      const indices = Array.from({ length: total }, (_, i) => i);
      const raws = await Promise.all(indices.map((i) => auctionRead.getAuction(i)));
      const now = Math.floor(Date.now() / 1000);
      const candidates = raws
        .map((a, i) => ({
          id: i,
          seller: a[0] as string,
          paymentToken: a[2] as string,
          deadline: Number(a[4]),
          status: Number(a[6]),
        }))
        .filter(
          (a) =>
            a.status === 0 &&
            a.paymentToken.toLowerCase() === CONTRACTS.ConfidentialToken.toLowerCase() &&
            a.deadline > now + 60 && // 60s buffer
            (account === null || a.seller.toLowerCase() !== account.toLowerCase()),
        )
        .sort((a, b) => b.id - a.id);

      const target = candidates[0];
      if (!target) {
        const msg =
          "No live sealed auction to bid on right now. Open /auctions to find one.";
        setStepError(msg);
        toast.warning("No live auction", msg);
        return;
      }

      const { Encryptable } = await import("@cofhe/sdk");
      const enc = await encrypt([Encryptable.uint64(parseAmount(SAMPLE_BID_AMOUNT)!)], CONTRACTS.SealedAuction);
      if (!enc) throw new Error("Encryption failed");

      const tx = await auctionContract.bid(target.id, enc.handles[0], enc.signature);
      await tx.wait();

      setProgress((prev) => {
        const next: Progress = {
          ...prev,
          step3Done: true,
          step3AuctionId: target.id,
          step3BidAmount: SAMPLE_BID_AMOUNT,
          step3TxHash: tx.hash,
        };
        saveProgress(next);
        return next;
      });
      toast.success(
        "Encrypted bid placed",
        `Sealed bid of ${SAMPLE_BID_AMOUNT} CDEX on auction #${target.id}.`,
      );
    } catch (err) {
      const msg = humanizeTxError(err);
      setStepError(msg);
      toast.error("Bid failed", msg);
    } finally {
      setBusyStep(null);
    }
  }, [
    auctionRead,
    auctionContract,
    cofheReady,
    account,
    encrypt,
    toast,
  ]);

  /* ── Step 4: Unseal own bid ── */
  const handleStep4 = useCallback(async () => {
    if (!auctionContract) {
      toast.error("Wallet not ready", "Finish step 1 first.");
      return;
    }
    if (progress.step3AuctionId === null) {
      toast.warning("No bid to unseal", "Run step 3 first to place a bid.");
      return;
    }
    setBusyStep(4);
    setStepError(null);
    try {
      const handle: unknown = await auctionContract.getMyBid(progress.step3AuctionId);
      // getMyBid returns the euint64 amount actually locked → FheTypes.Uint64 = 5.
      const value = await unseal(BigInt(String(handle)), 5);
      if (value === null) throw new Error("Unseal returned null");
      setProgress((prev) => {
        const next: Progress = {
          ...prev,
          step4Done: true,
          step4UnsealedAmount: value.toString(),
          step4Handle: BigInt(String(handle)).toString(16),
        };
        saveProgress(next);
        return next;
      });
      toast.success(
        "Bid unsealed",
        `You see ${formatAmount(value)} ${TOKEN_CONFIG.symbol}. Nobody else can.`,
      );
    } catch (err) {
      const msg = humanizeTxError(err);
      setStepError(msg);
      toast.error("Unseal failed", msg);
    } finally {
      setBusyStep(null);
    }
  }, [auctionContract, progress.step3AuctionId, unseal, toast]);

  /* ── Step 5: Privacy Lens demo ── */
  const handleLensMode = useCallback(
    (mode: "me" | "counterparty" | "observer") => {
      setProgress((prev) => {
        const seen = { ...prev.step5LensSeen, [mode]: true };
        const allThree = seen.me && seen.counterparty && seen.observer;
        const next: Progress = {
          ...prev,
          step5LensSeen: seen,
          step5Done: prev.step5Done || allThree,
        };
        saveProgress(next);
        if (allThree && !prev.step5Done) {
          toast.success("Privacy Lens unlocked", "All three perspectives seen.");
        }
        return next;
      });
    },
    [toast],
  );

  const resetProgress = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
    saveProgress(DEFAULT_PROGRESS);
    toast.info("Quickstart reset", "Progress cleared. Start from step 1.");
  }, [toast]);

  /* ── Render ── */
  if (!hydrated) {
    // Avoid SSR/CSR mismatch flash: hold render until localStorage loads
    return null;
  }

  const completedCount =
    Number(progress.step1Done) +
    Number(progress.step2Done) +
    Number(progress.step3Done) +
    Number(progress.step4Done) +
    Number(progress.step5Done);

  return (
    <div
      className="font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[920px] px-5 md:px-10 py-16 md:py-24 space-y-12">
        {/* HERO */}
        <header className="space-y-6">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            — Quickstart · ~3 minutes
          </div>
          <h1
            className="font-display font-bold tracking-tight leading-[1.04]"
            style={{
              fontSize: "clamp(38px, 5.4vw, 68px)",
              letterSpacing: "-0.04em",
            }}
          >
            Learn FHE by{" "}
            <em className="font-serif italic font-normal">doing FHE</em>.
          </h1>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "clamp(15px, 1.2vw, 17px)",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            Five steps. Every step actually runs on-chain. By the end you&apos;ve
            connected a wallet, claimed encrypted tokens, placed a sealed bid,
            unsealed it with your own permit, and seen what an outside observer
            sees instead. No videos, no docs — the product is the lesson.
          </p>

          {/* Progress meter */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <span
                className="font-mono uppercase tracking-[0.1em]"
                style={{ fontSize: 11, color: "var(--text-muted)" }}
              >
                {completedCount} of 5 complete
              </span>
              <button
                type="button"
                onClick={resetProgress}
                className="font-mono text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1.5 transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                <RefreshCw size={10} /> Reset
              </button>
            </div>
            <div
              style={{
                height: 3,
                background: "var(--bg-alt)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(completedCount / 5) * 100}%`,
                  background: "var(--text)",
                  transition: "width 0.4s var(--ease)",
                }}
              />
            </div>
          </div>
        </header>

        <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />

        {/* STEPS */}
        <div className="space-y-4">
          <Step
            n={1}
            Icon={Wallet}
            title="Connect a wallet"
            tagline="One-click burner — no MetaMask required."
            done={progress.step1Done}
            active={activeStep === 1}
            body={
              account
                ? `Connected as ${account.slice(0, 6)}…${account.slice(-4)} (${mode === "burner" ? "burner" : "injected"}).`
                : "We'll spin up a fresh wallet, fund it with a small amount of Sepolia ETH, and use it as your signer for the rest of the steps."
            }
          >
            {!progress.step1Done && (
              <button
                type="button"
                onClick={handleStep1}
                disabled={busyStep === 1 || connecting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {busyStep === 1 || connecting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wallet size={13} />
                )}
                {account ? "Continue" : "Spin up burner"}
              </button>
            )}
          </Step>

          <Step
            n={2}
            Icon={Coins}
            title="Fund your private vault"
            tagline={`Claim ${TOKEN_CONFIG.faucetAmount} test ${TOKEN_CONFIG.symbol}, then deposit ${QUICKSTART_DEPOSIT} into the vault — encrypted.`}
            done={progress.step2Done}
            active={activeStep === 2}
            body="Bids lock real funds, so you need a vault balance first. Your deposit amount is encrypted in your browser before it's sent; the chain only ever sees ciphertext. Three quick transactions: faucet, one-time vault approval, deposit."
          >
            {!progress.step2Done && (
              <button
                type="button"
                onClick={handleStep2}
                disabled={busyStep === 2 || !progress.step1Done}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {busyStep === 2 ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Coins size={13} />
                )}
                Claim {TOKEN_CONFIG.faucetAmount} {TOKEN_CONFIG.symbol}
              </button>
            )}
          </Step>

          <Step
            n={3}
            Icon={Lock}
            title="Place an encrypted bid"
            tagline={`Sample bid of ${SAMPLE_BID_AMOUNT} ${TOKEN_CONFIG.symbol} on the most recent live auction.`}
            done={progress.step3Done}
            active={activeStep === 3}
            body={
              progress.step3Done && progress.step3AuctionId !== null
                ? `Bid placed on auction #${progress.step3AuctionId}. The amount is encrypted on-chain — even validators see ciphertext.`
                : "We'll find the most recent live sealed auction, encrypt your bid amount in this browser, and submit it. Anyone reading the chain sees a sealed handle, not the number."
            }
            txHash={progress.step3TxHash ?? undefined}
          >
            {!progress.step3Done && (
              <button
                type="button"
                onClick={handleStep3}
                disabled={busyStep === 3 || !progress.step2Done || !cofheReady}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {busyStep === 3 ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Lock size={13} />
                )}
                {cofheReady
                  ? `Bid ${SAMPLE_BID_AMOUNT} ${TOKEN_CONFIG.symbol} encrypted`
                  : "Encryption WASM loading…"}
              </button>
            )}
          </Step>

          <Step
            n={4}
            Icon={Eye}
            title="Unseal your own bid"
            tagline="The cryptographic permit — only you can decrypt your bid."
            done={progress.step4Done}
            active={activeStep === 4}
            body={
              progress.step4Done && progress.step4UnsealedAmount !== null
                ? `You see ${progress.step4UnsealedAmount} ${TOKEN_CONFIG.symbol}. Burner #2 calling getMyBid would see only their own bid handle. The chain refuses cross-account decryption.`
                : "We'll fetch your encrypted bid handle from the contract and decrypt it locally with your permit signature. Burner #2 doing the same call sees their bid, not yours — the threshold network enforces it."
            }
          >
            {!progress.step4Done && (
              <button
                type="button"
                onClick={handleStep4}
                disabled={busyStep === 4 || !progress.step3Done}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  borderRadius: 8,
                }}
              >
                {busyStep === 4 ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Eye size={13} />
                )}
                Unseal my bid
              </button>
            )}
          </Step>

          <Step
            n={5}
            Icon={Sparkles}
            title="See it from three perspectives"
            tagline="Toggle the Privacy Lens — what you see vs. what an observer sees."
            done={progress.step5Done}
            active={activeStep === 5}
            body="Same auction, three viewers. You see your unsealed bid. A counterparty sees only what the contract grants them. A public observer sees ciphertext. Click each to unlock."
          >
            <PrivacyLensDemo
              seen={progress.step5LensSeen}
              onModeSelected={handleLensMode}
              myBidAmount={progress.step4UnsealedAmount}
              handle={progress.step4Handle}
            />
          </Step>
        </div>

        {/* ERROR PANEL */}
        {stepError && (
          <div
            className="px-5 py-4 flex items-start gap-3"
            style={{
              background: "var(--bg-card)",
              border: "1px dashed var(--border-dash)",
              borderRadius: 4,
              color: "var(--danger, #B53A2B)",
            }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] mb-1">
                — Error
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>{stepError}</p>
            </div>
          </div>
        )}

        {/* DONE PANEL */}
        {activeStep === "done" && (
          <section
            className="space-y-5 p-7"
            style={{
              background: "var(--text)",
              color: "var(--bg)",
              borderRadius: 4,
            }}
          >
            <div
              className="font-mono uppercase tracking-[0.12em] inline-flex items-center gap-2"
              style={{ fontSize: 11, color: "rgba(250,250,247,0.7)" }}
            >
              <Check size={12} />
              Quickstart complete
            </div>
            <h2
              className="font-display font-bold tracking-tight"
              style={{
                fontSize: "clamp(28px, 3.6vw, 44px)",
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
              }}
            >
              You&apos;ve run a real encrypted auction. The rest is{" "}
              <em className="font-serif italic font-normal">scale</em>.
            </h2>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.65,
                color: "rgba(250,250,247,0.78)",
                maxWidth: 640,
              }}
            >
              Same primitives power encrypted payroll, OTC desks, sealed
              treasury operations, and every auction variant — Vickrey,
              Dutch, Batch, Overflow. Pick where to go next.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/auctions"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  borderRadius: 8,
                }}
              >
                Run a real auction <ArrowRight size={13} />
              </Link>
              <Link
                href="/more"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
                style={{ color: "rgba(250,250,247,0.78)" }}
              >
                Explore every primitive <ArrowRight size={13} />
              </Link>
              <Link
                href="/audit"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
                style={{ color: "rgba(250,250,247,0.78)" }}
              >
                Verify the privacy claims <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────── */

function Step({
  n,
  Icon,
  title,
  tagline,
  body,
  done,
  active,
  children,
  txHash,
}: {
  n: 1 | 2 | 3 | 4 | 5;
  Icon: LucideIcon;
  title: string;
  tagline: string;
  body: string;
  done: boolean;
  active: boolean;
  children?: React.ReactNode;
  txHash?: string;
}) {
  const dim = !done && !active;
  return (
    <article
      className="px-5 py-5 md:px-7 md:py-6 space-y-4"
      style={{
        background: "var(--bg-card)",
        border: `1px ${active ? "solid" : "dashed"} ${
          done ? "var(--success)" : active ? "var(--text)" : "var(--border-dash)"
        }`,
        borderRadius: 4,
        opacity: dim ? 0.6 : 1,
        transition: "opacity 220ms ease",
      }}
    >
      <header className="flex items-start gap-4">
        <div
          className="shrink-0 w-10 h-10 flex items-center justify-center"
          style={{
            background: done ? "var(--success-bg)" : "var(--bg-alt)",
            border: `1px ${done ? "solid" : "dashed"} ${
              done ? "var(--success)" : "var(--border-dash)"
            }`,
            borderRadius: 4,
            color: done ? "var(--success)" : "var(--text)",
          }}
        >
          {done ? <Check size={16} /> : <Icon size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="font-mono uppercase tracking-[0.12em]"
              style={{ fontSize: 10, color: "var(--text-muted)" }}
            >
              — Step {String(n).padStart(2, "0")}
            </span>
            {done && (
              <span
                className="font-mono uppercase tracking-[0.12em]"
                style={{ fontSize: 10, color: "var(--success)" }}
              >
                · Done
              </span>
            )}
          </div>
          <h3
            className="font-display font-semibold mt-1"
            style={{
              fontSize: "clamp(18px, 1.8vw, 22px)",
              letterSpacing: "-0.015em",
              color: "var(--text)",
              lineHeight: 1.2,
            }}
          >
            {title}
          </h3>
          <p
            className="mt-1"
            style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}
          >
            {tagline}
          </p>
        </div>
      </header>

      <p
        style={{
          fontSize: 14,
          lineHeight: 1.65,
          color: "var(--text-secondary)",
        }}
      >
        {body}
      </p>

      {txHash && (
        <a
          href={`${FHENIX_TESTNET.blockExplorer}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-mono text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {txHash.slice(0, 12)}…{txHash.slice(-10)}
          <ExternalLink size={10} />
        </a>
      )}

      {children}
    </article>
  );
}

/* ─── Step 5 sub-component: in-page Privacy Lens demo ─── */

function PrivacyLensDemo({
  seen,
  onModeSelected,
  myBidAmount,
  handle,
}: {
  seen: { me: boolean; counterparty: boolean; observer: boolean };
  onModeSelected: (m: "me" | "counterparty" | "observer") => void;
  /** Unsealed bid in base units, or null if step 4 isn't done. */
  myBidAmount: string | null;
  /** Hex ciphertext handle of the bid, or null if not loaded. */
  handle: string | null;
}) {
  const [activeMode, setActiveMode] = useState<
    "me" | "counterparty" | "observer"
  >("me");

  const onSelect = useCallback(
    (m: "me" | "counterparty" | "observer") => {
      setActiveMode(m);
      onModeSelected(m);
    },
    [onModeSelected],
  );

  const value =
    activeMode === "me"
      ? myBidAmount
        ? `${formatAmount(myBidAmount)} ${TOKEN_CONFIG.symbol}`
        : "Unseal your bid in step 4 to see it here"
      : activeMode === "counterparty"
        ? "sealed — the seller and other bidders can't read it"
        : handle
          ? `0x${handle.slice(0, 20)}…${handle.slice(-4)}`
          : "ciphertext handle (loads after step 4)";

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <div className="flex flex-wrap gap-2">
        {(["me", "counterparty", "observer"] as const).map((m) => {
          const I =
            m === "me" ? User : m === "counterparty" ? Users : Globe2;
          const label =
            m === "me" ? "Me" : m === "counterparty" ? "Counterparty" : "Observer";
          const hasSeen = seen[m];
          const isActive = activeMode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: isActive ? "var(--text)" : "transparent",
                color: isActive ? "var(--bg)" : "var(--text-muted)",
                border: `1px ${isActive ? "solid" : "dashed"} ${
                  isActive ? "var(--text)" : "var(--border-dash)"
                }`,
                borderRadius: 6,
              }}
            >
              <I size={12} />
              <span>{label}</span>
              {hasSeen && !isActive && <Check size={11} />}
            </button>
          );
        })}
      </div>

      {/* Sample row */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-4"
        style={{
          background: "var(--bg-alt)",
          border: "1px dashed var(--border-dash)",
          borderRadius: 4,
        }}
      >
        <span
          className="font-mono uppercase tracking-[0.12em]"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          Bid amount
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 13,
            color: "var(--text)",
            fontWeight: activeMode === "me" ? 600 : 500,
          }}
        >
          {value}
        </span>
      </div>

      <p
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          lineHeight: 1.6,
        }}
      >
        {activeMode === "me"
          ? "← This is your view. Decrypted via your permit. Nobody else gets this."
          : activeMode === "counterparty"
            ? "← What the seller and other bidders see: nothing about your number."
            : "← What a public observer sees. The chain stores ciphertext hashes — encrypted forever."}
      </p>
    </div>
  );
}
