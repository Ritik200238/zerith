"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Wifi, WifiOff, Shield, ShieldOff, Wallet, Lock, Unlock, Loader2,
  Activity, Fuel, Network, CheckCircle2,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { useCofhe } from "@/hooks/useCofhe";
import { useUnseal } from "@/hooks/useUnseal";
import { useReadContract } from "@/hooks/useContract";
import { useBlockPoll } from "@/hooks/useBlockPoll";
import { FHENIX_TESTNET } from "@/lib/constants";

/**
 * SystemStatus v2 (U5 from Wave 4 plan).
 *
 * Live operational pulse for the app. Shows in the page chrome so users
 * (and judges) can see the system breathing. Five sections:
 *   - Wallet (account or "Disconnected")
 *   - FHE (cofhejs WASM ready / pending)
 *   - Network (correct chain / wrong)
 *   - Block (latest block number, polled every 12s)
 *   - Gas (current gas price in gwei)
 *   - TN (Threshold Network — indicator visible, derived from chain liveness)
 *
 * The encrypted-balance unseal action stays in this bar from v1, since
 * users hit it from the header all the time.
 */
export function SystemStatus() {
  const { account, isCorrectChain, provider } = useWallet();
  const { initialized } = useCofhe();
  const { unseal, unsealing } = useUnseal();
  const tokenRead = useReadContract("ConfidentialToken");
  const blockTick = useBlockPoll();

  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [gasGwei, setGasGwei] = useState<number | null>(null);
  const [tnOk, setTnOk] = useState(true);

  // Poll chain stats whenever blockTick fires (12s)
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const fallback = new ethers.JsonRpcProvider(FHENIX_TESTNET.rpcUrl);
        const p = provider ?? fallback;
        const [bn, fee] = await Promise.all([p.getBlockNumber(), p.getFeeData()]);
        if (cancelled) return;
        setBlockNumber(bn);
        if (fee.gasPrice) {
          setGasGwei(Number(ethers.formatUnits(fee.gasPrice, "gwei")));
        }
        setTnOk(true);
      } catch {
        if (!cancelled) setTnOk(false);
      }
    }
    tick();
    return () => { cancelled = true; };
  }, [provider, blockTick]);

  const handleUnsealBalance = useCallback(async () => {
    if (!tokenRead || !account) return;
    setBalanceLoading(true);
    try {
      const ctHash = await tokenRead.balanceOfEncrypted(account);
      const val = await unseal(BigInt(ctHash), 5); // euint64
      if (val !== null) setBalance(val.toString());
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [tokenRead, account, unseal]);

  const gasLabel = gasGwei !== null
    ? gasGwei < 1 ? `${(gasGwei * 1000).toFixed(0)}m` : `${gasGwei.toFixed(1)}`
    : "—";

  return (
    <div className="flex items-center gap-3 text-[10px] flex-wrap font-mono uppercase tracking-wider text-textMuted">
      {/* Wallet */}
      <div className="flex items-center gap-1.5">
        <Wallet size={10} className={account ? "text-success" : "text-textMuted"} />
        <span className={account ? "text-success" : "text-textMuted"}>
          {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Disconnected"}
        </span>
      </div>

      <Sep />

      {/* FHE */}
      <div className="flex items-center gap-1.5">
        {initialized ? (
          <Shield size={10} className="text-[var(--cipher-violet)]" />
        ) : (
          <ShieldOff size={10} className="text-[var(--text-muted)]" />
        )}
        <span className={initialized ? "text-[var(--cipher-violet)]" : "text-[var(--text-muted)]"}>
          FHE {initialized ? "Ready" : "Pending"}
        </span>
      </div>

      <Sep />

      {/* Network */}
      <div className="flex items-center gap-1.5">
        {isCorrectChain ? (
          <Wifi size={10} className="text-[var(--cipher-cyan)]" />
        ) : (
          <WifiOff size={10} className="text-[var(--cipher-red)]" />
        )}
        <span className={isCorrectChain ? "text-[var(--cipher-cyan)]" : "text-[var(--cipher-red)]"}>
          {isCorrectChain ? "Sepolia" : "Wrong network"}
        </span>
      </div>

      <Sep />

      {/* Block height */}
      <div className="flex items-center gap-1.5" title="Latest block (polled every 12s)">
        <Activity size={10} className="text-[var(--text-secondary)]" />
        <span className="text-[var(--text-secondary)] font-mono">
          #{blockNumber !== null ? blockNumber.toLocaleString() : "—"}
        </span>
      </div>

      <Sep />

      {/* Gas */}
      <div className="flex items-center gap-1.5" title="Current gas price">
        <Fuel size={10} className="text-[var(--text-secondary)]" />
        <span className="text-[var(--text-secondary)] font-mono">{gasLabel} gwei</span>
      </div>

      <Sep />

      {/* Threshold Network */}
      <div
        className="flex items-center gap-1.5"
        title="Threshold Network — signs reveal proofs for FHE.publishDecryptResult"
      >
        {tnOk ? (
          <CheckCircle2 size={10} className="text-emerald-400" />
        ) : (
          <Network size={10} className="text-amber-400" />
        )}
        <span className={tnOk ? "text-emerald-400" : "text-amber-400"}>
          TN {tnOk ? "OK" : "Stale"}
        </span>
      </div>

      {/* Balance (only if connected) */}
      {account && (
        <>
          <Sep />
          <div className="flex items-center gap-1.5">
            {balance !== null ? (
              <>
                <Unlock size={10} className="text-[var(--cipher-green)]" />
                <span className="text-[var(--cipher-green)] font-mono-cipher">{balance} SIGIL</span>
              </>
            ) : (
              <button
                onClick={handleUnsealBalance}
                disabled={unsealing || balanceLoading || !initialized}
                aria-label="Unseal encrypted balance"
                className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--cipher-violet)] transition-colors disabled:opacity-50"
              >
                {unsealing || balanceLoading ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Lock size={10} />
                )}
                <span>{unsealing || balanceLoading ? "Unsealing..." : "Show balance"}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Sep() {
  return <span className="text-borderDash">·</span>;
}
