"use client";

export const dynamic = "force-dynamic";

/**
 * Token Vesting — /vesting
 *
 * View vesting schedules where you are the beneficiary. Claim vested
 * tokens. Encrypted totalAmount + claimed; only beneficiary can unseal.
 *
 * Note: Schedule creation is admin/authorizedCreator-only (typically
 * called by auction contracts on settlement). End-users see + claim only.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Calendar, Loader2, RefreshCw, Lock, Eye, CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useUnseal } from "@/hooks/useUnseal";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { PrivacyLens } from "@/components/shared/PrivacyLens";
import { CONTRACTS } from "@/lib/constants";
import { formatAmount, shortAddress } from "@/lib/format";

interface ScheduleData {
  id: number;
  beneficiary: string;
  token: string;
  granter: string;
  startTime: number;
  cliffEnd: number;
  vestingEnd: number;
  revoked: boolean;
  vestedPct: number;
  encTotalHandle: string | null;
  encClaimedHandle: string | null;
  unsealedTotal: string | null;
  unsealedClaimed: string | null;
}

export default function VestingPage() {
  const { account } = useWallet();
  const { unseal } = useUnseal();
  const toast = useToast();

  // getMyVestedAmount / getMyClaimed depend on msg.sender — use signer-bound.
  // getSchedule / getBeneficiarySchedules / getVestedPercentage take explicit args.
  const vestingContract = useContract("TokenVesting");
  const vestingRead = useContract("TokenVesting");
  const vestingReadProvider = useReadContract("TokenVesting");

  const deployed = CONTRACTS.TokenVesting !== "0x0000000000000000000000000000000000000000";

  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Token Vesting", type: "payment", href: "/vesting", txHash });

  const fetchSchedules = useCallback(async () => {
    if (!account) return;
    try {
      const provider = vestingReadProvider;
      const signed = vestingRead;
      if (!provider || !signed) return;
      const ids = await provider.getBeneficiarySchedules(account);
      const out: ScheduleData[] = [];
      for (const idBn of ids) {
        const id = Number(idBn);
        try {
          const s = await provider.getSchedule(id);
          let pct = 0;
          try {
            pct = Number(await provider.getVestedPercentage(id));
          } catch {}
          let encTotal: string | null = null;
          let encClaimed: string | null = null;
          // getMyVestedAmount / getMyClaimed use msg.sender — must go through signed contract
          try {
            const t = await signed.getMyVestedAmount(id);
            encTotal = t.toString();
          } catch {}
          try {
            const c = await signed.getMyClaimed(id);
            encClaimed = c.toString();
          } catch {}
          // getSchedule returns: [0]beneficiary [1]token [2]granter
          // [3]cliffEnd [4]vestingEnd [5]revoked. NOTE: the getter does
          // NOT return startTime — only the public schedules() mapping does.
          out.push({
            id,
            beneficiary: s[0],
            token: s[1],
            granter: s[2],
            startTime: 0,
            cliffEnd: Number(s[3]),
            vestingEnd: Number(s[4]),
            revoked: Boolean(s[5]),
            vestedPct: pct,
            encTotalHandle: encTotal,
            encClaimedHandle: encClaimed,
            unsealedTotal: null,
            unsealedClaimed: null,
          });
        } catch {
          /* skip */
        }
      }
      setSchedules(out);
    } catch {
      /* noop */
    }
  }, [vestingRead, vestingReadProvider, account]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchSchedules();
  }, [fetchSchedules, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => {
    setSchedules([]);
    setRefreshKey((k) => k + 1);
  }, []));

  const handleClaim = useCallback(
    async (id: number) => {
      if (!vestingContract) return;
      setTxState("signing");
      try {
        const tx = await vestingContract.claimVested(id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Claim failed", msg);
      }
    },
    [vestingContract, toast],
  );

  const handleReveal = useCallback(
    async (id: number, field: "total" | "claimed") => {
      const s = schedules.find((x) => x.id === id);
      if (!s) return;
      const handle = field === "total" ? s.encTotalHandle : s.encClaimedHandle;
      if (!handle) return;
      const v = await unseal(BigInt(handle), 5);
      if (v !== null) {
        setSchedules((prev) =>
          prev.map((x) =>
            x.id === id
              ? field === "total"
                ? { ...x, unsealedTotal: v.toString() }
                : { ...x, unsealedClaimed: v.toString() }
              : x,
          ),
        );
      }
    },
    [schedules, unseal],
  );

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Token Vesting" shipDate="soon" />
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
          — Token vesting
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Cliff + linear.{" "}<em className="font-serif italic font-normal">Amounts encrypted</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Set up vesting schedules with cliff and linear release. Recipients see their own claim — outsiders see schedules without amounts.
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

      <div className="rounded bg-[var(--text)]/5 border border-[var(--text)]/20 p-3 flex items-start gap-2 text-xs my-4">
        <AlertCircle size={14} className="text-[var(--text)] shrink-0 mt-0.5" />
        <span className="text-[var(--text-secondary)]">
          Vesting schedules are created by authorized contracts (e.g. auction settlements) — not from this page directly.
          You see and claim schedules where you are the beneficiary.
        </span>
      </div>

      <div className="mb-6">
        <PrivacyLens
          title="Vesting Privacy"
          rows={[
            {
              label: "Schedule timeline (cliff → end)",
              meValue: "Public — visible to anyone",
              counterpartyValue: "Public — visible to anyone",
              observerValue: "Public — visible to anyone",
              encrypted: false,
            },
            {
              label: "Beneficiary & granter",
              meValue: "Public addresses",
              counterpartyValue: "Public addresses",
              observerValue: "Public addresses",
              encrypted: false,
            },
            {
              label: "Total grant amount",
              meValue: "Visible to you only (unseal)",
              counterpartyValue: "🔒 sealed",
              observerValue: "🔒 sealed",
              encrypted: true,
            },
            {
              label: "Claimed amount",
              meValue: "Visible to you only (unseal)",
              counterpartyValue: "🔒 sealed",
              observerValue: "🔒 sealed",
              encrypted: true,
            },
          ]}
        />
      </div>

      <section className="grid gap-3">
        {schedules.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-8 text-center">
            <Calendar size={28} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">No vesting schedules for your address</p>
          </div>
        ) : (
          schedules.map((s) => {
            const cliffPassed = s.cliffEnd < Math.floor(Date.now() / 1000);
            return (
              <article key={s.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{s.id}</span>
                    {s.revoked && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-alt)] text-[var(--text-muted)]">REVOKED</span>
                    )}
                    {!s.revoked && cliffPassed && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-alt)] text-[var(--text)]">VESTING</span>
                    )}
                    {!s.revoked && !cliffPassed && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-alt)] text-[var(--text-muted)]">CLIFF</span>
                    )}
                    <span className="text-[10px] text-[var(--text-muted)]">granter {shortAddress(s.granter)}</span>
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock size={12} />
                    cliff {new Date(s.cliffEnd * 1000).toLocaleDateString()} → end {new Date(s.vestingEnd * 1000).toLocaleDateString()}
                  </span>
                </div>

                <div className="mt-3 grid md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Vested %</div>
                    <div className="font-mono text-[var(--text)]">{s.vestedPct}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total grant</div>
                    {s.unsealedTotal !== null ? (
                      <div className="font-mono text-[var(--text)]">{formatAmount(s.unsealedTotal)}</div>
                    ) : (
                      <button onClick={() => handleReveal(s.id, "total")}
                        className="font-mono text-[var(--text)] flex items-center gap-1 hover:text-[var(--text)] transition-colors">
                        <Lock size={10} /> reveal
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Claimed</div>
                    {s.unsealedClaimed !== null ? (
                      <div className="font-mono text-[var(--text)]">{formatAmount(s.unsealedClaimed)}</div>
                    ) : (
                      <button onClick={() => handleReveal(s.id, "claimed")}
                        className="font-mono text-[var(--text)] flex items-center gap-1 hover:text-[var(--text)] transition-colors">
                        <Lock size={10} /> reveal
                      </button>
                    )}
                  </div>
                </div>

                {/* Vesting bar */}
                <div className="mt-3 h-1.5 rounded-full bg-[var(--bg-alt)] overflow-hidden">
                  <div className="h-full bg-text from-[var(--text)] to-[var(--text)] transition-all"
                    style={{ width: `${s.vestedPct}%` }} />
                </div>

                {!s.revoked && cliffPassed && (
                  <div className="mt-3">
                    <button onClick={() => handleClaim(s.id)} disabled={txState === "signing" || txState === "confirming"}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors disabled:opacity-40">
                      {txState === "signing" || txState === "confirming"
                        ? <Loader2 size={12} className="animate-spin" />
                        : <CheckCircle2 size={12} />}
                      Claim vested
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
