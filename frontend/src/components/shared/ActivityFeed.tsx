"use client";

/**
 * ActivityFeed — U7 from the Wave 4 plan.
 *
 * Live counters across every contract that exposes a getXxxCount() view.
 * Polls the chain every 12s via useBlockPoll. Shows the running total
 * for each feature so the app feels alive — empty values indicate the
 * feature is wired but not yet active in the wild.
 *
 * The content here is *count-only*. Amounts, bidders, prices stay
 * encrypted. We never reveal individual activity, just the public
 * "12 auctions live, 3 streams running" surface.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Gavel, Eye, TrendingDown, Layers, Droplets, Send, Briefcase,
  ArrowLeftRight, Activity, Building2, Sparkles, Trophy,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { useBlockPoll } from "@/hooks/useBlockPoll";
import { CONTRACTS, FHENIX_TESTNET, type ContractName } from "@/lib/constants";
import { getReadContract } from "@/lib/contracts";

type FeedEntry = {
  contract: ContractName;
  label: string;
  unit: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** view-function name returning a uint count */
  getter: string;
};

const FEED: FeedEntry[] = [
  { contract: "SealedAuction",       label: "Sealed Auctions",        unit: "auctions", href: "/auctions",  icon: Gavel,          getter: "getAuctionCount" },
  { contract: "VickreyAuction",      label: "Vickrey Auctions",       unit: "auctions", href: "/vickrey",   icon: Eye,            getter: "getAuctionCount" },
  { contract: "DutchAuction",        label: "Dutch Auctions",         unit: "auctions", href: "/dutch",     icon: TrendingDown,   getter: "getAuctionCount" },
  { contract: "BatchAuction",        label: "Batch Rounds",           unit: "rounds",   href: "/batch",     icon: Layers,         getter: "getRoundCount" },
  { contract: "OverflowSale",        label: "Overflow Sales",         unit: "sales",    href: "/overflow",  icon: Droplets,       getter: "getSaleCount" },
  { contract: "PrivatePayments",     label: "Payment Splits",         unit: "splits",   href: "/payments",  icon: Send,           getter: "getSplitCount" },
  { contract: "FreelanceBidding",    label: "Freelance Jobs",         unit: "jobs",     href: "/freelance", icon: Briefcase,      getter: "getJobCount" },
  { contract: "OrderBook",           label: "Active Orders",          unit: "orders",   href: "/trade",     icon: ArrowLeftRight, getter: "getActiveOrderCount" },
  { contract: "EncryptedStreaming",  label: "Active Streams",         unit: "streams",  href: "/streaming", icon: Activity,       getter: "getStreamCount" },
  { contract: "Organization",        label: "Organizations",          unit: "orgs",     href: "/agent",     icon: Building2,      getter: "getOrgCount" },
  { contract: "ConfidentialMultisig", label: "Confidential Multisigs", unit: "vaults",  href: "/audit",     icon: Sparkles,       getter: "getMultisigCount" },
  { contract: "EncryptedRaffle",     label: "Encrypted Raffles",      unit: "raffles",  href: "/raffle",    icon: Trophy,         getter: "getRaffleCount" },
];

interface Props {
  /** Layout — "grid" for landing, "list" for sidebar. */
  variant?: "grid" | "list";
  /** Title shown above the feed. Hide with empty string. */
  title?: string;
}

export function ActivityFeed({ variant = "grid", title = "Live activity" }: Props) {
  const { provider } = useWallet();
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const blockTick = useBlockPoll();

  const fetchAll = useCallback(async () => {
    const fallback = new ethers.JsonRpcProvider(FHENIX_TESTNET.rpcUrl);
    const p = provider ?? fallback;
    const next: Record<string, number | null> = {};
    await Promise.all(
      FEED.map(async (f) => {
        const addr = CONTRACTS[f.contract];
        if (!addr || addr === "0x0000000000000000000000000000000000000000") {
          next[f.contract] = null;
          return;
        }
        try {
          const c = getReadContract(f.contract, p);
          const fn = c.getFunction(f.getter);
          const v = await fn.staticCall();
          next[f.contract] = Number(v);
        } catch {
          next[f.contract] = null;
        }
      }),
    );
    setCounts(next);
    setLoading(false);
    setLastUpdated(Date.now());
  }, [provider]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, blockTick]);

  return (
    <section className="space-y-4">
      {title && (
        <div className="flex items-center justify-between">
          <span
            className="font-mono flex items-center gap-1.5"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            <Activity size={11} />
            {title}
          </span>
          {lastUpdated && (
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
              }}
            >
              updated {Math.round((Date.now() - lastUpdated) / 1000)}s ago
            </span>
          )}
        </div>
      )}

      <div
        className={
          variant === "grid"
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
            : "space-y-2"
        }
      >
        {FEED.map((f, i) => {
          const Icon = f.icon;
          const value = counts[f.contract];
          const display = loading ? "…" : value === null ? "—" : value.toLocaleString();

          return (
            <motion.a
              key={f.contract}
              href={f.href}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025 }}
              className="block p-3 transition-colors group"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
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
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon size={12} className="shrink-0 text-textMuted" />
                  <span
                    className="truncate"
                    style={{ fontSize: 11, color: "var(--text-secondary)" }}
                  >
                    {f.label}
                  </span>
                </div>
                <span
                  className="font-mono"
                  style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}
                >
                  {display}
                </span>
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                {f.unit}
              </div>
            </motion.a>
          );
        })}
      </div>
    </section>
  );
}
