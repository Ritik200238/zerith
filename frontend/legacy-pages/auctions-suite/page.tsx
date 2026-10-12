"use client";

export const dynamic = "force-dynamic";

/**
 * Auction Suite — /auctions-suite
 *
 * Curated hub for the 5 sealed-bid mechanisms. Without this, judges and
 * users see five separate nav items at equal weight and have to know which
 * to click. Closes the audit gap: "No picker/landing page for auction suite."
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Gavel,
  Eye,
  TrendingDown,
  Layers,
  Droplets,
  Lock,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useReadContract } from "@/hooks/useContract";
import { useBlockPoll } from "@/hooks/useBlockPoll";
import { Card } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { SectionLabel } from "@/components/shared/SectionLabel";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { CONTRACTS, type ContractName } from "@/lib/constants";

type Mechanism = {
  key: string;
  name: string;
  href: string;
  Icon: typeof Gavel;
  contract: ContractName;
  /** Method on the contract that returns total count. */
  countMethod: "getAuctionCount" | "getRoundCount" | "getSaleCount";
  /** One-line pitch — what the mechanism does. */
  pitch: string;
  /** Who it's for — the practical use case. */
  bestFor: string;
  /** Special tag — innovation, novelty, etc. */
  badge?: string;
};

const MECHANISMS: Mechanism[] = [
  {
    key: "sealed",
    name: "Sealed-Bid",
    href: "/auctions",
    Icon: Gavel,
    contract: "SealedAuction",
    countMethod: "getAuctionCount",
    pitch: "Highest encrypted bid wins, pays own price. Losing bids never decrypt.",
    bestFor: "Single-item launches, premium NFT-like assets, demos of FHE in action.",
    badge: "Blind Floor mode available",
  },
  {
    key: "vickrey",
    name: "Vickrey (2nd-Price)",
    href: "/vickrey",
    Icon: Eye,
    contract: "VickreyAuction",
    countMethod: "getAuctionCount",
    pitch: "Highest bidder wins but pays the second-highest price. Strategy-proof — bid your true value.",
    bestFor: "Honest price discovery. Truthful bidding without strategizing.",
    badge: "Strategy-proof",
  },
  {
    key: "dutch",
    name: "Dutch",
    href: "/dutch",
    Icon: TrendingDown,
    contract: "DutchAuction",
    countMethod: "getAuctionCount",
    pitch: "Price decays over time. First buyer to accept the current price wins.",
    bestFor: "Time-pressured launches, fast-clearing inventory, fair price discovery without bidding wars.",
  },
  {
    key: "batch",
    name: "Batch / Clearing",
    href: "/batch",
    Icon: Layers,
    contract: "BatchAuction",
    countMethod: "getRoundCount",
    pitch: "Many bidders submit price + quantity. One uniform clearing price for all.",
    bestFor: "Token launches, IDO-style sales, recurring rounds where fairness matters more than gamification.",
  },
  {
    key: "overflow",
    name: "Overflow / Fixed-Price",
    href: "/overflow",
    Icon: Droplets,
    contract: "OverflowSale",
    countMethod: "getSaleCount",
    pitch: "Fixed price sale. If oversubscribed, FHE computes pro-rata allocation without revealing individual contributions.",
    bestFor: "ICOs, NFT mints, any sale where everyone pays the same price.",
  },
];

interface CountState {
  [key: string]: number | null;
}

export default function AuctionSuitePage() {
  const sealedRead = useReadContract("SealedAuction");
  const vickreyRead = useReadContract("VickreyAuction");
  const dutchRead = useReadContract("DutchAuction");
  const batchRead = useReadContract("BatchAuction");
  const overflowRead = useReadContract("OverflowSale");

  const [counts, setCounts] = useState<CountState>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchCounts = useCallback(async () => {
    const next: CountState = {};
    const reads: [string, ReturnType<typeof useReadContract>, Mechanism["countMethod"]][] = [
      ["sealed", sealedRead, "getAuctionCount"],
      ["vickrey", vickreyRead, "getAuctionCount"],
      ["dutch", dutchRead, "getAuctionCount"],
      ["batch", batchRead, "getRoundCount"],
      ["overflow", overflowRead, "getSaleCount"],
    ];
    for (const [key, c, method] of reads) {
      if (!c) {
        next[key] = null;
        continue;
      }
      try {
        const v = await c[method]();
        next[key] = Number(v);
      } catch {
        next[key] = null;
      }
    }
    setCounts(next);
    setLoaded(true);
  }, [sealedRead, vickreyRead, dutchRead, batchRead, overflowRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts, refreshKey, blockTick]);

  const totalCount = MECHANISMS.reduce((sum, m) => sum + (counts[m.key] ?? 0), 0);

  return (
    <main className="max-w-container mx-auto px-6 py-12 md:py-16 space-y-16">
      {/* HEADER */}
      <header className="space-y-4">
        <SectionLabel>AUCTION SUITE</SectionLabel>
        <h1 className="display">
          Five <em>sealed-bid</em> mechanisms. One privacy guarantee.
        </h1>
        <p className="body-lg max-w-2xl">
          Pick the auction shape that fits the deal. Every mechanism keeps bid amounts
          encrypted on-chain via Fhenix FHE — only the final outcome decrypts.
        </p>
        <div className="flex gap-3 pt-2">
          <FaucetButton />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            leftIcon={<RefreshCw className="w-3 h-3" />}
          >
            Refresh counts
          </Button>
        </div>
      </header>

      {/* TOTAL */}
      <section>
        <Card noHover>
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <div className="mono text-textMuted mb-1">TOTAL ACROSS ALL MECHANISMS</div>
              {loaded ? (
                <div className="font-display text-4xl font-bold">
                  {totalCount}{" "}
                  <span className="font-body font-normal text-textMuted text-xl">
                    auctions ever created
                  </span>
                </div>
              ) : (
                <div className="font-display text-4xl font-bold flex items-center gap-3 text-textMuted">
                  <span
                    className="inline-block h-9 w-16 rounded animate-pulse"
                    style={{ background: "var(--bg-alt)" }}
                    aria-hidden
                  />
                  <span className="mono text-sm font-normal inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    syncing…
                  </span>
                </div>
              )}
            </div>
            <div className="mono text-textMuted">
              {MECHANISMS.length} mechanisms · 100% encrypted bids
            </div>
          </div>
        </Card>
      </section>

      {/* MECHANISM GRID */}
      <section className="space-y-6">
        <SectionLabel>MECHANISMS</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MECHANISMS.map((m) => {
            const count = counts[m.key];
            const Icon = m.Icon;
            return (
              <Card key={m.key}>
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5" style={{ color: "var(--text)" }} />
                      <h3 className="heading-sm">{m.name}</h3>
                    </div>
                    {m.badge && (
                      <span
                        className="badge inline-flex items-center gap-1"
                        style={{ color: "var(--accent-2)" }}
                      >
                        <Lock className="w-3 h-3" />
                        {m.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-textSecondary">{m.pitch}</p>
                  <div>
                    <div className="mono text-textMuted mb-1">BEST FOR</div>
                    <p className="text-sm">{m.bestFor}</p>
                  </div>
                  <hr style={{ border: "none", borderTop: "1px dashed var(--border-dash)" }} />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="mono text-textMuted">LIVE COUNT</div>
                      {loaded ? (
                        <div className="font-display text-2xl">
                          {count == null ? "—" : count.toString()}
                        </div>
                      ) : (
                        <div className="h-8 flex items-center" aria-label="syncing">
                          <span
                            className="inline-block h-6 w-10 rounded animate-pulse"
                            style={{ background: "var(--bg-alt)" }}
                            aria-hidden
                          />
                        </div>
                      )}
                    </div>
                    <Link href={m.href} className="btn btn-primary btn-sm">
                      Open
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* FOOTER NOTE */}
      <section>
        <Card noHover compact>
          <div className="flex items-start gap-3">
            <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--accent-2)" }} />
            <p className="text-sm text-textSecondary">
              Every mechanism uses the same privacy backbone: encrypted bids submitted via
              <code className="mx-1 px-1 font-mono text-xs" style={{ background: "var(--bg-alt)" }}>@cofhe/sdk</code>,
              compared on-chain via FHE.gt / FHE.max / FHE.gte, and revealed via the
              Fhenix Threshold Network with on-chain signature verification.
              <strong> Losing bids never decrypt — ever.</strong>
            </p>
          </div>
        </Card>
      </section>
    </main>
  );
}
