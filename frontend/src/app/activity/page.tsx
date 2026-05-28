"use client";

export const dynamic = "force-dynamic";

/**
 * Activity Log — /activity
 *
 * Per-wallet chronological history aggregated from the hero contracts.
 * Closes the audit gap: "Activity Log page does not exist." Treasury covers
 * point-in-time state; Activity covers what HAS HAPPENED.
 *
 * v1 sources (the surfaces a real user actually uses):
 *   • PrivatePayments — splits I created or am a recipient of
 *   • SealedAuction   — auctions I bid on (scans hasBid mapping)
 *   • ProofOfReserves — proofs I've requested or had revealed
 *
 * Future: add OTC requests/quotes, other auction types, freelance jobs.
 * v1 deliberately keeps the source list focused so the page is fast and the
 * code stays readable. The per-source helpers are easy to extend.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  Gavel,
  ShieldCheck,
  ExternalLink,
  Lock,
  RefreshCw,
  Filter,
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { Card } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { SectionLabel } from "@/components/shared/SectionLabel";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { CONTRACTS, FHENIX_TESTNET, TOKEN_CONFIG } from "@/lib/constants";
import { formatAmount } from "@/lib/format";

type EventType = "payment-sent" | "payment-received" | "auction-bid" | "por-request";

interface ActivityEvent {
  type: EventType;
  timestamp: number;
  href: string;
  primary: string;       // headline
  secondary?: string;    // subline
  status?: string;       // status badge text
  statusKind?: "ok" | "bad" | "pending" | "neutral";
  encrypted: boolean;    // whether the amount/value behind this row is encrypted
}

const TYPE_META: Record<EventType, { label: string; Icon: typeof CreditCard }> = {
  "payment-sent":     { label: "Payment sent",      Icon: CreditCard },
  "payment-received": { label: "Payment received",  Icon: CreditCard },
  "auction-bid":      { label: "Auction bid",       Icon: Gavel },
  "por-request":      { label: "Proof of reserves", Icon: ShieldCheck },
};

const FILTERS: { key: "all" | EventType; label: string }[] = [
  { key: "all",             label: "All" },
  { key: "payment-sent",    label: "Sent" },
  { key: "payment-received", label: "Received" },
  { key: "auction-bid",     label: "Bids" },
  { key: "por-request",     label: "Reserves" },
];

export default function ActivityPage() {
  const { account } = useWallet();
  const payments = useReadContract("PrivatePayments");
  const sealed = useReadContract("SealedAuction");
  const por = useReadContract("ProofOfReserves");

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<typeof FILTERS[number]["key"]>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  /* ─── Source: PrivatePayments ─── */
  const fetchPayments = useCallback(async (): Promise<ActivityEvent[]> => {
    if (!payments || !account) return [];
    const out: ActivityEvent[] = [];

    // Splits I created
    try {
      const ids: bigint[] = await payments.getCreatorHistory(account);
      for (const id of ids) {
        const s = await payments.splits(id);
        out.push({
          type: "payment-sent",
          timestamp: Number(s[6]),
          href: "/payments",
          primary: `Sent to ${Number(s[3])} recipient${Number(s[3]) === 1 ? "" : "s"}`,
          secondary: `Total: ${formatAmount(BigInt(s[2]))} ${TOKEN_CONFIG.symbol} · Split #${id.toString()}`,
          status: Number(s[5]) === 0 ? "FUNDED" : Number(s[5]) === 1 ? "COMPLETED" : "CANCELLED",
          statusKind: Number(s[5]) === 1 ? "ok" : Number(s[5]) === 0 ? "pending" : "bad",
          encrypted: true,
        });
      }
    } catch {
      /* contract may be unreachable; skip silently */
    }

    // Splits I'm a recipient of
    try {
      const ids: bigint[] = await payments.getRecipientHistory(account);
      for (const id of ids) {
        const s = await payments.splits(id);
        out.push({
          type: "payment-received",
          timestamp: Number(s[6]),
          href: "/payments",
          primary: `Received from ${shortAddr(s[0])}`,
          secondary: `Split #${id.toString()} · your amount sealed (unseal in /payments)`,
          status: Number(s[5]) === 0 ? "PENDING CLAIM" : "COMPLETED",
          statusKind: Number(s[5]) === 1 ? "ok" : "pending",
          encrypted: true,
        });
      }
    } catch {
      /* ignore */
    }

    return out;
  }, [payments, account]);

  /* ─── Source: SealedAuction ─── */
  const fetchAuctionBids = useCallback(async (): Promise<ActivityEvent[]> => {
    if (!sealed || !account) return [];
    const out: ActivityEvent[] = [];
    try {
      const total = Number(await sealed.getAuctionCount());
      const indices = Array.from({ length: total }, (_, i) => i);
      // Parallel: check hasBid + getAuction for every index in two waves.
      const [bidFlags, auctionRaws] = await Promise.all([
        Promise.all(indices.map((i) => sealed.hasBid(i, account))),
        Promise.all(indices.map((i) => sealed.getAuction(i))),
      ]);
      bidFlags.forEach((placed, i) => {
        if (!placed) return;
        const a = auctionRaws[i];
        out.push({
          type: "auction-bid",
          // Sealed Auction doesn't store per-bid timestamp; use deadline as the
          // most meaningful timestamp for sorting (auction-end is when bid
          // resolves). Frontend orders by this; user sees "by deadline".
          timestamp: Number(a[4]),
          href: "/auctions",
          primary: `Bid on auction #${i}`,
          secondary: `Seller ${shortAddr(a[0])} · amount ${formatAmount(a[3].toString())} ${shortAddr(a[1]).slice(-4)}`,
          status:
            Number(a[6]) === 0 ? "OPEN" :
            Number(a[6]) === 1 ? "AWAITING REVEAL" :
            Number(a[6]) === 2 ? "REVEALED" :
            Number(a[6]) === 3 ? "SETTLED" :
            Number(a[6]) === 4 ? "CANCELLED" : "RESERVE NOT MET",
          statusKind:
            Number(a[6]) === 3 ? "ok" :
            Number(a[6]) === 0 || Number(a[6]) === 1 ? "pending" :
            Number(a[6]) === 4 || Number(a[6]) === 5 ? "bad" : "neutral",
          encrypted: Number(a[6]) < 2, // before reveal, your bid amount is encrypted
        });
      });
    } catch {
      /* ignore */
    }
    return out;
  }, [sealed, account]);

  /* ─── Source: ProofOfReserves ─── */
  const fetchProofs = useCallback(async (): Promise<ActivityEvent[]> => {
    if (!por || !account) return [];
    const out: ActivityEvent[] = [];
    try {
      const ids: bigint[] = await por.getProverClaims(account);
      const claims = await Promise.all(ids.map((id) => por.getClaim(id)));
      claims.forEach((c, idx) => {
        const id = ids[idx];
        out.push({
          type: "por-request",
          timestamp: Number(c[3]),
          href: "/treasury",
          primary: `Proof of reserves: ≥ ${formatAmount(BigInt(c[2]))} ${TOKEN_CONFIG.symbol}`,
          secondary: `Claim #${id.toString()}${Number(c[4]) > 0 ? ` · revealed ${new Date(Number(c[4]) * 1000).toLocaleDateString()}` : ""}`,
          status:
            Number(c[5]) === 0 ? "PENDING" :
            Number(c[5]) === 1 ? "VERIFIED ≥" : "VERIFIED <",
          statusKind:
            Number(c[5]) === 1 ? "ok" :
            Number(c[5]) === 0 ? "pending" : "bad",
          encrypted: true,
        });
      });
    } catch {
      /* ignore */
    }
    return out;
  }, [por, account]);

  /* ─── Aggregate ─── */
  const fetchAll = useCallback(async () => {
    if (!account) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([fetchPayments(), fetchAuctionBids(), fetchProofs()]);
      const merged = [...a, ...b, ...c].sort((x, y) => y.timestamp - x.timestamp);
      setEvents(merged);
    } finally {
      setLoading(false);
    }
  }, [account, fetchPayments, fetchAuctionBids, fetchProofs]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey, blockTick]);

  useAccountChangeReset(useCallback(() => {
    setEvents([]);
    setRefreshKey((k) => k + 1);
  }, []));

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.type === filter)),
    [events, filter],
  );

  return (
    <main className="max-w-container mx-auto px-6 py-12 md:py-16 space-y-12">
      {/* HEADER */}
      <header className="space-y-4">
        <SectionLabel>ACTIVITY</SectionLabel>
        <h1 className="display">
          Your encrypted <em>history</em>, in one feed.
        </h1>
        <p className="body-lg max-w-2xl">
          Payments, auction bids, reserve proofs — every action you&apos;ve taken on Zerith
          in chronological order. Amounts stay sealed; only you can unseal your own data.
        </p>
        <div className="flex gap-3 pt-2">
          <FaucetButton />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            leftIcon={<RefreshCw className="w-3 h-3" />}
          >
            Refresh
          </Button>
        </div>
      </header>

      {/* FILTER */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
          <span className="mono text-textMuted mr-2">FILTER</span>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: filter === f.key ? "var(--text)" : "transparent",
                color: filter === f.key ? "var(--bg)" : "var(--text-muted)",
                border: "1px dashed var(--border-dash)",
                borderRadius: 6,
              }}
            >
              {f.label}
            </button>
          ))}
          <span className="mono text-textMuted ml-auto">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {/* FEED */}
      <section className="space-y-3">
        {!account ? (
          <Card noHover>
            <p className="text-textMuted text-center py-8">Connect your wallet to see your activity.</p>
          </Card>
        ) : loading && events.length === 0 ? (
          <Card noHover>
            <p className="text-textMuted text-center py-8">Loading your history…</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card noHover>
            <div className="flex flex-col items-center py-10 gap-3">
              <Inbox className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
              <p className="text-textMuted">
                {events.length === 0
                  ? "No activity yet. Open Payments or an Auction to start."
                  : "No events match this filter."}
              </p>
            </div>
          </Card>
        ) : (
          filtered.map((ev, i) => <EventRow key={`${ev.type}-${ev.timestamp}-${i}`} ev={ev} />)
        )}
      </section>

      {/* PRIVACY NOTE */}
      <section>
        <Card noHover compact>
          <div className="flex items-start gap-3">
            <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--accent-2)" }} />
            <p className="text-sm text-textSecondary">
              Activity rows reveal that an event happened and which feature it touched. Encrypted
              amounts (payroll per-recipient, your auction bid amount) stay sealed on-chain — open
              the feature page and use Unseal to view them with your personal permit.
              <strong> Other people&apos;s amounts on the same events are mathematically inaccessible to you.</strong>
            </p>
          </div>
        </Card>
      </section>
    </main>
  );
}

/* ─── Sub-components ─── */

function EventRow({ ev }: { ev: ActivityEvent }) {
  const meta = TYPE_META[ev.type];
  const Icon = meta.Icon;
  return (
    <Link href={ev.href} className="block group">
      <div
        className="px-5 py-4 flex items-start gap-4 transition-colors"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-dash)",
          borderRadius: 4,
        }}
      >
        <div
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center"
          style={{ border: "1px dashed var(--border-dash)", borderRadius: 4 }}
        >
          <Icon className="w-4 h-4" style={{ color: "var(--text)" }} />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="mono text-textMuted">{meta.label.toUpperCase()}</span>
            {ev.encrypted && (
              <span
                className="badge inline-flex items-center gap-1"
                style={{ color: "var(--text-muted)" }}
              >
                <Lock className="w-3 h-3" />
                SEALED
              </span>
            )}
            {ev.status && <StatusBadge text={ev.status} kind={ev.statusKind ?? "neutral"} />}
            <span className="mono text-textMuted ml-auto">
              {ev.timestamp > 0 ? new Date(ev.timestamp * 1000).toLocaleString() : "—"}
            </span>
          </div>
          <div className="text-sm font-semibold text-text">{ev.primary}</div>
          {ev.secondary && <div className="text-xs text-textMuted">{ev.secondary}</div>}
        </div>

        <ExternalLink
          className="w-3 h-3 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-muted)" }}
        />
      </div>
    </Link>
  );
}

function StatusBadge({ text, kind }: { text: string; kind: "ok" | "bad" | "pending" | "neutral" }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "bad" ? XCircle : kind === "pending" ? Clock : Inbox;
  const color =
    kind === "ok" ? "var(--success, #2f7a55)" :
    kind === "bad" ? "var(--danger, #a33)" :
    kind === "pending" ? "var(--text-muted)" :
    "var(--text-muted)";
  return (
    <span className="badge inline-flex items-center gap-1" style={{ color }}>
      <Icon className="w-3 h-3" />
      {text}
    </span>
  );
}

function shortAddr(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
