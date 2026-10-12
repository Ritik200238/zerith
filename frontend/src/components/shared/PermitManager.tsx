"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Key, Plus, RefreshCw, ChevronDown, ShieldCheck, AlertCircle } from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";

/**
 * Access-permission manager — header dropdown for the user's ACPs.
 *
 * An ACP (Access Control Permission, CoFHE 1.0's replacement for permits) is a
 * signed permission that lets the user decrypt values they're allowed to read,
 * such as their own vault balance or bid. This lists the ACPs stored for the
 * connected wallet, prompts to renew one that's about to expire, and revokes
 * one on-chain so it can never be used again.
 *
 * Trust posture: privacy infrastructure must be visible AND controllable.
 */

const ROTATION_WINDOW_SECONDS = 30 * 24 * 60 * 60; // 30 days
const EXPIRY_PROMPT_SECONDS = 24 * 60 * 60; // surface prompt with <24h left

interface PermitInfo {
  hash: string;
  name?: string;
  expiresAt?: number; // unix seconds
}

function formatRemaining(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function shortenHash(h: string): string {
  if (h.length < 12) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

type SdkACP = { name?: string; expiration?: number };
type CofheClient = {
  acp: {
    getACPs: () => Record<string, SdkACP>;
    createSelf: (opts: { issuer: string; name?: string; expiration?: number }) => Promise<SdkACP>;
    revokeACP: (acp: SdkACP) => Promise<string>;
    removeACP: (hash: string) => void;
  };
};

export function PermitManager() {
  const { account, isCorrectChain } = useWallet();
  const { initialized, client } = useCofhe();
  const [open, setOpen] = useState(false);
  const [permits, setPermits] = useState<PermitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!initialized || !client || !account) {
      setPermits([]);
      return;
    }
    try {
      const c = client as CofheClient;
      const mapped: PermitInfo[] = Object.entries(c.acp.getACPs() ?? {}).map(([hash, p]) => ({
        hash,
        name: p.name,
        expiresAt: p.expiration,
      }));
      setPermits(mapped);
    } catch {
      setPermits([]);
    }
  }, [initialized, client, account]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000); // refresh every 30s
    return () => clearInterval(t);
  }, [refresh]);

  // Click outside closes dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleCreate = useCallback(async () => {
    if (!account || !client) return;
    setBusy(true);
    setError(null);
    try {
      const c = client as CofheClient;
      await c.acp.createSelf({
        issuer: account,
        name: "Zerith",
        expiration: Math.floor(Date.now() / 1000) + ROTATION_WINDOW_SECONDS,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 80) : "Couldn't create the access permission");
    } finally {
      setBusy(false);
    }
  }, [account, client, refresh]);

  const handleRevoke = useCallback(
    async (permitHash: string) => {
      if (!account || !client) return;
      setBusy(true);
      setError(null);
      try {
        const c = client as CofheClient;
        const acp = c.acp.getACPs()?.[permitHash];
        // Revoke on-chain so the ACP can never be used again, then forget it locally.
        if (acp) await c.acp.revokeACP(acp);
        c.acp.removeACP(permitHash);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message.slice(0, 80) : "Failed to revoke");
      } finally {
        setBusy(false);
      }
    },
    [account, client, refresh],
  );

  // Detect any permit expiring soon — surface the renew prompt
  const expiringPermit = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return permits.find(
      (p) => p.expiresAt && p.expiresAt - now > 0 && p.expiresAt - now < EXPIRY_PROMPT_SECONDS,
    );
  }, [permits]);

  if (!account || !isCorrectChain) return null;

  const activeCount = permits.length;
  const hasExpiring = Boolean(expiringPermit);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed
                    transition-colors bg-bgCard
                    ${hasExpiring
                      ? "border-warning text-warning"
                      : "border-borderDash text-textSecondary hover:border-textMuted"}`}
        aria-label="Manage access permissions"
        title={hasExpiring ? "An access permission is expiring soon" : "Manage access permissions"}
      >
        {hasExpiring ? (
          <AlertCircle size={12} className="text-warning" />
        ) : (
          <Key size={12} className={initialized ? "text-success" : "text-textMuted"} />
        )}
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {activeCount} ACP{activeCount === 1 ? "" : "s"}
        </span>
        <ChevronDown
          size={11}
          className={`text-textMuted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-[340px]
                       bg-bgCard border border-dashed border-borderDash rounded
                       shadow-[0_12px_32px_rgba(17,17,17,0.06)] overflow-hidden z-50"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-dashed border-borderDash">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-success" />
                <h3 className="font-display text-sm font-semibold text-text">
                  Access permissions
                </h3>
              </div>
              <p className="text-[11px] text-textMuted mt-0.5 leading-relaxed">
                Signed permissions (ACPs) that let you decrypt your own data.
              </p>
            </div>

            {/* Expiry prompt */}
            {hasExpiring && expiringPermit && (
              <div className="px-4 py-3 bg-warning/[0.08] border-b border-dashed border-warning/40">
                <div className="flex items-start gap-2">
                  <AlertCircle size={13} className="text-warning mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-warning">
                      Access permission expiring soon
                    </p>
                    <p className="text-[10px] text-textSecondary mt-0.5">
                      {shortenHash(expiringPermit.hash)} expires in{" "}
                      {expiringPermit.expiresAt
                        ? formatRemaining(expiringPermit.expiresAt)
                        : "<24h"}
                      . Renew now to avoid an interrupted decrypt.
                    </p>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={busy}
                      className="btn btn-primary btn-sm mt-2"
                    >
                      <RefreshCw size={11} />
                      <span>Renew (30 days)</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Permit list */}
            <div className="max-h-[280px] overflow-y-auto">
              {permits.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] text-textMuted leading-relaxed">
                    No access permissions yet.
                  </p>
                  <p className="text-[10px] text-textMuted mt-1 opacity-70">
                    They&apos;ll be created when you decrypt your first value.
                  </p>
                </div>
              ) : (
                permits.map((p) => (
                  <div
                    key={p.hash}
                    className="px-4 py-3 border-b border-dashed border-borderDash last:border-b-0
                               flex items-center justify-between gap-3 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-mono text-text truncate">
                        {shortenHash(p.hash)}
                      </p>
                      {p.expiresAt && (
                        <p className="text-[10px] text-textMuted mt-0.5">
                          Expires in {formatRemaining(p.expiresAt)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(p.hash)}
                      disabled={busy}
                      className="opacity-0 group-hover:opacity-100 transition
                                 px-2 py-1 rounded border border-dashed border-danger/40
                                 text-[10px] font-medium text-danger
                                 hover:bg-danger/[0.08] disabled:opacity-30"
                      aria-label="Revoke access permission on-chain"
                    >
                      Revoke
                    </button>
                  </div>
                ))
              )}
            </div>

            {error && (
              <div className="px-4 py-2 bg-danger/[0.06] border-t border-dashed border-danger/30">
                <p className="text-[10px] text-danger">{error}</p>
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 border-t border-dashed border-borderDash
                            flex items-center justify-between gap-2 bg-bgCardHover">
              <div className="flex items-center gap-1.5 text-[10px] text-textMuted font-mono uppercase tracking-wider">
                <RefreshCw size={9} />
                <span>Rotate every 30 days</span>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy}
                className="btn btn-outline btn-sm"
              >
                <Plus size={11} />
                <span>New ACP</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
