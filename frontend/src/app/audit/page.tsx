"use client";

export const dynamic = "force-dynamic";

/**
 * Public Privacy Audit Dashboard at /audit.
 *
 * Wave 4 WOW feature — opens the books. Every contract, every encrypted
 * vs public field, every FHE op, every live count. We let judges and users
 * verify the privacy claims by reading the actual on-chain schema.
 *
 * Three sections:
 *   1. Top-line stats — contract count, FHE ops, network, decryption events
 *   2. Per-contract privacy posture — schema + live counts
 *   3. Aggregate FHE op list — all distinct operations used anywhere
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Shield, Lock, Eye, EyeOff, ExternalLink, Activity,
  CheckCircle2, AlertTriangle, Layers, Zap,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { CONTRACTS, FHENIX_TESTNET, type ContractName } from "@/lib/constants";
import {
  PRIVACY_AUDIT, aggregateFheOps, fheContractCount, type PrivacyDescriptor, type PrivacyStage,
} from "@/lib/privacy-audit";
import { getReadContract } from "@/lib/contracts";
import { FaucetButton } from "@/components/shared/FaucetButton";

const STAGE_BADGE: Record<PrivacyStage, { label: string; bg: string; text: string; tooltip: string }> = {
  1: {
    label: "Stage 1",
    bg: "bg-[var(--bg-alt)]",
    text: "text-[var(--text-muted)]",
    tooltip: "Public on-chain by design — registry / merkle / ERC721 metadata.",
  },
  2: {
    label: "Stage 2",
    bg: "bg-[var(--bg-alt)]",
    text: "text-[var(--text)]",
    tooltip: "Encrypted at rest. Only the settlement result is revealed via Threshold Network signature.",
  },
  3: {
    label: "Stage 3",
    bg: "bg-[var(--bg-alt)]",
    text: "text-[var(--text)]",
    tooltip: "End-to-end encrypted. The handle never gets decrypted on-chain — owners read via permit only.",
  },
};

/* ------------------------------------------------------------------ */
/*  Live count fetcher                                                 */
/* ------------------------------------------------------------------ */

async function fetchLiveCount(
  name: ContractName,
  desc: PrivacyDescriptor,
  provider: ethers.Provider | null,
): Promise<number | null> {
  if (!provider || !desc.countGetter) return null;
  try {
    const c = getReadContract(name, provider);
    const fn = c.getFunction(desc.countGetter);
    const raw = await fn.staticCall();
    return Number(raw);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AuditPage() {
  const { provider } = useWallet();
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loadingCounts, setLoadingCounts] = useState(true);

  // Fall back to a public RPC if the wallet provider is missing.
  const fallbackProvider = useFallbackProvider();
  const activeProvider = provider ?? fallbackProvider;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoadingCounts(true);
      const next: Record<string, number | null> = {};
      const entries = Object.entries(PRIVACY_AUDIT) as [ContractName, PrivacyDescriptor][];
      await Promise.all(
        entries.map(async ([name, desc]) => {
          if (!desc.countGetter) return;
          const v = await fetchLiveCount(name, desc, activeProvider);
          next[name] = v;
        }),
      );
      if (!cancelled) {
        setCounts(next);
        setLoadingCounts(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [activeProvider]);

  const totalEncryptedFields = Object.values(PRIVACY_AUDIT).reduce(
    (sum, d) => sum + (d?.encryptedFields.length ?? 0),
    0,
  );
  const allOps = aggregateFheOps();
  const fheCount = fheContractCount();
  const totalContracts = Object.keys(PRIVACY_AUDIT).length;

  return (
    <main
      className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* Hero */}
      <header className="mb-12 space-y-6">
        <div
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
        >
          — Public privacy audit
        </div>
        <h1
          className="font-display font-bold tracking-tight leading-[1.02] max-w-3xl mb-4"
          style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
        >
          We open the{" "}
          <em className="font-serif italic font-normal">books</em>.
        </h1>
        <p
          className="max-w-2xl"
          style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}
        >
          Every contract Zerith deploys is listed below. For each, we publish the schema —
          which fields are encrypted, which are public, and which FHE operations the contract
          calls. Live counts come straight from the chain. No claim is unverifiable.
        </p>
        <div>
          <FaucetButton />
        </div>
      </header>

      {/* Top-line stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <StatCard icon={Layers} label="Contracts deployed" value={String(totalContracts)} />
        <StatCard icon={Lock} label="Contracts using FHE" value={String(fheCount)} />
        <StatCard icon={EyeOff} label="Encrypted fields" value={String(totalEncryptedFields)} />
        <StatCard icon={Zap} label="Distinct FHE ops" value={String(allOps.length)} />
      </section>

      {/* Network info */}
      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4 mb-8 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Activity size={14} className="text-[var(--text)]" />
          <span className="text-[var(--text-secondary)]">Network:</span>
          <span className="text-[var(--text)] font-medium">{FHENIX_TESTNET.name}</span>
          <span className="text-[var(--text-muted)] font-mono text-[11px]">chainId {FHENIX_TESTNET.chainId}</span>
        </div>
        <a
          href={FHENIX_TESTNET.blockExplorer}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--text)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
        >
          Open block explorer <ExternalLink size={12} />
        </a>
      </section>

      {/* Per-contract */}
      <section className="space-y-3 mb-12">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-3">
          Per-contract privacy posture
        </h2>
        {Object.entries(PRIVACY_AUDIT).map(([name, desc], idx) => {
          if (!desc) return null;
          const address = CONTRACTS[name as ContractName];
          const live = counts[name];
          return (
            <motion.article
              key={name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.02 }}
              style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5"
            >
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-[var(--text)]">
                      {desc.title}
                    </h3>
                    <span
                      title={STAGE_BADGE[desc.stage].tooltip}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${STAGE_BADGE[desc.stage].bg} ${STAGE_BADGE[desc.stage].text}`}
                    >
                      {STAGE_BADGE[desc.stage].label}
                    </span>
                    {desc.emitsReveals && (
                      <span
                        title="Contract emits a reveal event when Threshold Network signs a decryption."
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-alt)] text-[var(--text)]"
                      >
                        emits reveals
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">{desc.purpose}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {desc.countLabel && (
                    <div className="text-right">
                      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                        {desc.countLabel}
                      </div>
                      {loadingCounts ? (
                        <div className="text-sm font-mono text-[var(--text)]">…</div>
                      ) : live === null ? (
                        <div
                          title="Live on-chain count could not be loaded — this claim is currently unverifiable. Check your network connection or RPC."
                          className="flex items-center justify-end gap-1 text-sm font-mono text-[var(--warning,#B47A1B)]"
                        >
                          <AlertTriangle size={12} />
                          <span>unverifiable</span>
                        </div>
                      ) : (
                        <div className="text-sm font-mono text-[var(--text)]">
                          {(live ?? 0).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                  <a
                    href={`${FHENIX_TESTNET.blockExplorer}/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[var(--text)] hover:text-[var(--text)] flex items-center gap-1 font-mono"
                  >
                    {address.slice(0, 8)}…{address.slice(-6)}
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <FieldList
                  icon={Lock}
                  iconColor="text-[var(--text)]"
                  title="Encrypted on-chain"
                  fields={desc.encryptedFields}
                  emptyHint="(no encrypted state — utility contract)"
                />
                <FieldList
                  icon={Eye}
                  iconColor="text-[var(--text-muted)]"
                  title="Public on-chain"
                  fields={desc.publicFields}
                  emptyHint="(no public state)"
                />
              </div>

              {desc.fheOps.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--border-dash)]">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
                    FHE operations used
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {desc.fheOps.map((op) => (
                      <span
                        key={op}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--text)]/10 text-[var(--text)]"
                      >
                        {op}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.article>
          );
        })}
      </section>

      {/* All FHE ops */}
      <section style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-5 mb-10">
        <h2 className="text-base font-semibold text-[var(--text)] mb-3">
          Aggregate FHE operations
        </h2>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Every distinct call into the FHE library across the entire codebase.
        </p>
        <div className="flex flex-wrap gap-2">
          {allOps.map((op) => (
            <span
              key={op}
              className="px-2.5 py-1 rounded text-xs font-mono bg-[var(--text)]/10 text-[var(--text)] border border-[var(--text)]/20"
            >
              {op}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-[11px] text-[var(--text-muted)] py-6">
        <p className="flex items-center justify-center gap-1.5">
          <CheckCircle2 size={12} className="text-[var(--text)]" />
          Schema generated from <code>src/lib/privacy-audit.ts</code>. Live counts pulled at page load.
        </p>
        <p className="mt-2">
          Found a discrepancy? <Link href="/" className="underline hover:text-[var(--text-secondary)]">Report it on the homepage</Link>.
        </p>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <Icon size={12} className="text-[var(--text)]" />
        {label}
      </div>
      <div className="text-2xl font-bold text-[var(--text)] mt-1.5 font-mono">
        {value}
      </div>
    </div>
  );
}

function FieldList({
  icon: Icon,
  iconColor,
  title,
  fields,
  emptyHint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor: string;
  title: string;
  fields: string[];
  emptyHint: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        <Icon size={12} className={iconColor} />
        {title}
      </div>
      {fields.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)] italic">{emptyHint}</p>
      ) : (
        <ul className="space-y-1">
          {fields.map((f) => (
            <li
              key={f}
              className="text-[11px] font-mono text-[var(--text-secondary)] flex items-center gap-1.5"
            >
              <span className={`w-1 h-1 rounded-full ${iconColor.replace("text-", "bg-")} shrink-0`} />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fallback RPC for unauthenticated visitors                          */
/* ------------------------------------------------------------------ */

function useFallbackProvider() {
  const [p, setP] = useState<ethers.JsonRpcProvider | null>(null);
  useEffect(() => {
    try {
      setP(new ethers.JsonRpcProvider(FHENIX_TESTNET.rpcUrl));
    } catch {
      setP(null);
    }
  }, []);
  return p;
}
