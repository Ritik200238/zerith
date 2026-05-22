"use client";

/**
 * BurnerControls — combined "Try instantly" CTA + active-burner badge.
 *
 * Behavior:
 *   - When wallet is disconnected: renders a "Try instantly" pill.
 *   - When mode === "burner": renders a small badge with a dropdown to:
 *       • Copy the burner address
 *       • Export the burner private key (with strong warning)
 *       • Disconnect (clears local storage)
 *   - When mode === "injected": renders nothing — MetaMask UI takes over.
 *
 * Placement: used in Navbar.tsx, slotted next to WalletConnect.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame,
  Zap,
  Loader2,
  Copy,
  Check,
  EyeOff,
  Eye,
  AlertTriangle,
  LogOut,
  X,
  ExternalLink,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { FHENIX_TESTNET } from "@/lib/constants";

const MONO_LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const VALUE_BOX: React.CSSProperties = {
  background: "var(--bg-alt)",
  border: "1px dashed var(--border-dash)",
  borderRadius: "var(--radius)",
};

export function BurnerControls() {
  const { account, mode, connecting, createAndConnectBurner, error } = useWallet();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleTryInstantly = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await createAndConnectBurner();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create burner";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }, [createAndConnectBurner]);

  // ── Branch 1: disconnected → show the Try Instantly CTA ──
  if (!account) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTryInstantly}
          disabled={creating || connecting}
          className="btn btn-outline btn-sm"
          title="Generate a one-click test wallet — no MetaMask needed"
          aria-label="Try Zerith instantly with a one-click test wallet"
        >
          {creating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          <span>{creating ? "Creating…" : "Try Instantly"}</span>
        </button>
        {(createError || error) && !creating && (
          <span
            className="text-xs max-w-48 truncate"
            style={{ color: "var(--danger, #d77757)" }}
            title={createError ?? error ?? ""}
          >
            {createError ?? error}
          </span>
        )}
      </div>
    );
  }

  // ── Branch 2: burner active → show badge with dropdown ──
  if (mode === "burner") {
    return <BurnerBadgeDropdown />;
  }

  // ── Branch 3: injected MetaMask wallet → nothing (WalletConnect handles UI) ──
  return null;
}

/**
 * The small chip + dropdown shown when the burner is active.
 * Renders the address, balance hint, and the dangerous actions
 * (export key, disconnect) behind explicit confirmations.
 */
function BurnerBadgeDropdown() {
  const { account, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-away to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!account) return null;
  const shortAddr = `${account.slice(0, 6)}…${account.slice(-4)}`;

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded transition-colors"
          style={{
            background: "var(--bg-alt)",
            border: "1px dashed var(--border-dash)",
          }}
          title="Burner wallet (demo mode)"
          aria-label="Burner wallet menu"
          aria-expanded={open}
        >
          <Flame size={12} style={{ color: "#d77757" }} />
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--text)",
              letterSpacing: "0.04em",
            }}
          >
            {shortAddr}
          </span>
          <span
            className="font-mono hidden md:inline"
            style={MONO_LABEL}
          >
            Burner
          </span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 mt-2 w-72 z-50"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-dash)",
                borderRadius: "var(--radius)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
              }}
            >
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px dashed var(--border-dash)" }}
              >
                <p className="font-mono mb-1" style={MONO_LABEL}>
                  — Demo burner wallet
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Generated in your browser. Funded with a small amount of Sepolia
                  ETH so you can try Zerith without MetaMask.
                </p>
              </div>

              <div className="px-2 py-2 flex flex-col">
                <CopyAddressRow address={account} />
                <a
                  href={`${FHENIX_TESTNET.blockExplorer}/address/${account}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 rounded transition-colors"
                  style={{ color: "var(--text)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-alt)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ fontSize: 12 }}>View on Etherscan</span>
                  <ExternalLink size={11} style={{ color: "var(--text-muted)" }} />
                </a>
                <button
                  onClick={() => {
                    setExportOpen(true);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between px-3 py-2 rounded transition-colors text-left"
                  style={{ color: "var(--text)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-alt)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ fontSize: 12 }}>Export private key</span>
                  <Eye size={11} style={{ color: "var(--text-muted)" }} />
                </button>
                <button
                  onClick={() => {
                    disconnect();
                    setOpen(false);
                  }}
                  className="flex items-center justify-between px-3 py-2 rounded transition-colors text-left"
                  style={{ color: "var(--danger, #d77757)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-alt)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ fontSize: 12 }}>Disconnect (clears key)</span>
                  <LogOut size={11} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ExportKeyModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

function CopyAddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center justify-between px-3 py-2 rounded transition-colors text-left"
      style={{ color: "var(--text)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-alt)")}
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span style={{ fontSize: 12 }}>{copied ? "Address copied" : "Copy address"}</span>
      {copied ? (
        <Check size={11} style={{ color: "var(--success)" }} />
      ) : (
        <Copy size={11} style={{ color: "var(--text-muted)" }} />
      )}
    </button>
  );
}

function ExportKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { burnerPrivateKey } = useWallet();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setRevealed(false);
      setCopied(false);
    }
  }, [open]);

  if (!burnerPrivateKey) return null;

  const masked = "•".repeat(64);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(17,17,17,0.50)", backdropFilter: "blur(6px)" }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92%] max-w-md"
            style={{
              background: "var(--bg-card)",
              border: "1px dashed var(--border-dash)",
              borderRadius: "var(--radius)",
            }}
            role="dialog"
            aria-label="Export burner private key"
          >
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px dashed var(--border-dash)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 flex items-center justify-center"
                  style={{
                    background: "var(--bg-alt)",
                    border: "1px dashed var(--border-dash)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <AlertTriangle size={14} style={{ color: "#d77757" }} />
                </div>
                <h3
                  className="font-display font-semibold"
                  style={{ fontSize: 14, color: "var(--text)" }}
                >
                  Export burner private key
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5"
                style={{ color: "var(--text-muted)" }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  lineHeight: 1.55,
                }}
              >
                This key controls a <strong>demo wallet on Sepolia testnet</strong>.
                It holds test tokens only. Never reuse it for mainnet funds. Anyone
                with this key can spend the burner's testnet balance.
              </p>

              <div className="p-3" style={VALUE_BOX}>
                <p
                  className="font-mono break-all"
                  style={{
                    fontSize: 11,
                    color: revealed ? "var(--text)" : "var(--text-muted)",
                    letterSpacing: revealed ? "0" : "0.05em",
                  }}
                >
                  {revealed ? burnerPrivateKey : masked}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRevealed((v) => !v)}
                  className="btn btn-outline btn-sm flex-1 justify-center"
                >
                  {revealed ? (
                    <>
                      <EyeOff size={13} /> Hide
                    </>
                  ) : (
                    <>
                      <Eye size={13} /> Reveal
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(burnerPrivateKey);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  disabled={!revealed}
                  className="btn btn-primary btn-sm flex-1 justify-center"
                  style={{ opacity: revealed ? 1 : 0.45 }}
                >
                  {copied ? (
                    <>
                      <Check size={13} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={13} /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
