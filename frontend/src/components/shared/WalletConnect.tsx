"use client";

import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { FHENIX_TESTNET } from "@/lib/constants";
import { Wallet, LogOut, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Wallet connection control — editorial style.
 * - Disconnected: dark primary "Connect Wallet" button
 * - Wrong chain: outline button prompting network switch
 * - Connected: short address chip + FHE pulse dot + disconnect
 */
export function WalletConnect() {
  const { account, connecting, isCorrectChain, error, connect, disconnect, switchToFhenix } =
    useWallet();
  const { initialized, initializing } = useCofhe();

  // Not connected
  if (!account) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className="btn btn-primary btn-sm"
        >
          {connecting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Wallet size={14} />
          )}
          <span>{connecting ? "Connecting..." : "Connect Wallet"}</span>
        </button>
        {error && (
          <span className="text-xs text-danger max-w-48 truncate" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  // Connected but wrong chain
  if (!isCorrectChain) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={switchToFhenix}
          className="btn btn-outline btn-sm"
        >
          <AlertTriangle size={14} className="text-warning" />
          <span>Switch to {FHENIX_TESTNET.name}</span>
        </button>
        <button
          type="button"
          onClick={disconnect}
          className="p-2 rounded text-textMuted hover:text-text hover:bg-bgAlt transition-colors"
          title="Disconnect"
          aria-label="Disconnect wallet"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  // Connected + correct chain
  const shortAddr = `${account.slice(0, 6)}…${account.slice(-4)}`;

  const fheLabel = initialized ? "FHE Ready" : initializing ? "Initializing" : "FHE Offline";
  const fheColor = initialized ? "bg-success" : initializing ? "bg-warning animate-pulse" : "bg-textMuted";

  return (
    <div className="flex items-center gap-2">
      {/* FHE status pip */}
      <div
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border border-dashed border-borderDash bg-bgCard"
        title={fheLabel}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${fheColor}`} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-textMuted">
          {fheLabel}
        </span>
      </div>

      {/* Address chip */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-dashed border-borderDash bg-bgCard font-mono text-xs text-text"
        title={account}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        {shortAddr}
      </div>

      <button
        type="button"
        onClick={disconnect}
        className="p-2 rounded text-textMuted hover:text-text hover:bg-bgAlt transition-colors"
        title="Disconnect"
        aria-label="Disconnect wallet"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
