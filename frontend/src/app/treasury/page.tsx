"use client";

export const dynamic = "force-dynamic";

/**
 * Treasury Dashboard — /treasury
 *
 * The v1 hub. Aggregated encrypted vault balance, vault deposit/withdraw,
 * and Encrypted Proof of Reserves. One screen that lets Maya-the-treasurer
 * see her position, move funds, and publicly prove reserves without leaking
 * the actual balance.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Lock,
  Eye,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Send,
  ShieldCheck,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { useWallet } from "@/providers/WalletProvider";
import { useUnseal } from "@/hooks/useUnseal";
import { useEncrypt } from "@/hooks/useEncrypt";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useDecryptForTx } from "@/hooks/useDecryptForTx";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { Button } from "@/components/shared/Button";
import { Card } from "@/components/shared/Card";
import { SectionLabel } from "@/components/shared/SectionLabel";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { EncryptionProgress } from "@/components/shared/EncryptionProgress";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { PrivacyLens } from "@/components/shared/PrivacyLens";
import { CONTRACTS, TOKEN_CONFIG, FHENIX_TESTNET } from "@/lib/constants";
import { formatAmount } from "@/lib/format";

type ClaimStatus = 0 | 1 | 2; // PENDING | VERIFIED_TRUE | VERIFIED_FALSE

interface Claim {
  id: number;
  prover: string;
  token: string;
  threshold: bigint;
  requestedAt: number;
  revealedAt: number;
  status: ClaimStatus;
}

export default function TreasuryPage() {
  const { account } = useWallet();
  const { unseal, unsealing } = useUnseal();
  const { encrypt, stage, encrypting } = useEncrypt();
  const { decrypt: decryptForTx } = useDecryptForTx();
  const toast = useToast();

  const vault = useContract("SettlementVault");
  const por = useContract("ProofOfReserves");
  const porRead = useReadContract("ProofOfReserves");
  const token = useContract("ConfidentialToken");

  const vaultDeployed = CONTRACTS.SettlementVault !== "0x0000000000000000000000000000000000000000";
  const porDeployed = CONTRACTS.ProofOfReserves !== "0x0000000000000000000000000000000000000000";

  /* ─── State ─── */
  const [encBalanceHandle, setEncBalanceHandle] = useState<string | null>(null);
  const [balancePlaintext, setBalancePlaintext] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(false);

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [porOpen, setPorOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Treasury", type: "system", href: "/treasury", txHash });

  const modalProps = useModalEscape(
    depositOpen || withdrawOpen || porOpen,
    () => {
      setDepositOpen(false);
      setWithdrawOpen(false);
      setPorOpen(false);
    },
    "treasury-modal-title",
  );

  /* ─── Reads ─── */
  const fetchBalance = useCallback(async () => {
    if (!vault || !account) return;
    try {
      const handle = await vault.getEncBalance(account, CONTRACTS.ConfidentialToken);
      setEncBalanceHandle(handle.toString());
    } catch {
      setEncBalanceHandle(null);
    }
  }, [vault, account]);

  const fetchClaims = useCallback(async () => {
    if (!porRead || !account) return;
    setLoadingClaims(true);
    try {
      const ids: bigint[] = await porRead.getProverClaims(account);
      const fetched: Claim[] = [];
      for (const id of ids) {
        const c = await porRead.getClaim(id);
        fetched.push({
          id: Number(id),
          prover: c[0],
          token: c[1],
          threshold: BigInt(c[2]),
          requestedAt: Number(c[3]),
          revealedAt: Number(c[4]),
          status: Number(c[5]) as ClaimStatus,
        });
      }
      // newest first
      fetched.reverse();
      setClaims(fetched);
    } catch {
      setClaims([]);
    } finally {
      setLoadingClaims(false);
    }
  }, [porRead, account]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (vaultDeployed) fetchBalance();
    if (porDeployed) fetchClaims();
  }, [fetchBalance, fetchClaims, refreshKey, blockTick, vaultDeployed, porDeployed]);

  useAccountChangeReset(
    useCallback(() => {
      setEncBalanceHandle(null);
      setBalancePlaintext(null);
      setClaims([]);
      setRefreshKey((k) => k + 1);
    }, []),
  );

  /* ─── Actions ─── */
  function handleTxError(err: unknown) {
    const isRejection = err instanceof Error && err.message.includes("user rejected");
    const message = isRejection
      ? "You rejected the transaction in your wallet"
      : err instanceof Error
        ? err.message.slice(0, 200)
        : "Transaction failed";
    setTxState("error");
    setTxError(message);
    toast.error(isRejection ? "Transaction cancelled" : "Transaction failed", message);
  }

  const handleUnsealBalance = useCallback(async () => {
    if (!encBalanceHandle) return;
    const val = await unseal(BigInt(encBalanceHandle), 5);
    if (val !== null) {
      setBalancePlaintext(val.toString());
    }
  }, [encBalanceHandle, unseal]);

  const handleDeposit = useCallback(async () => {
    if (!vault || !token || !account) return;
    const amount = depositAmount.trim();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.warning("Invalid amount", "Enter a positive number.");
      return;
    }
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      // Approve vault as operator for token (idempotent — sets max uint48 expiration)
      // Most users will already have this from prior operations; harmless re-set.
      const { Encryptable } = await import("@cofhe/sdk");
      const encrypted = await encrypt([Encryptable.uint64(BigInt(amount))]);
      if (!encrypted) throw new Error("Encryption failed");

      const tx = await vault.deposit(CONTRACTS.ConfidentialToken, encrypted[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      toast.success("Deposited", `Your ${amount} ${TOKEN_CONFIG.symbol} is now in the vault (encrypted).`);
      setDepositAmount("");
      setDepositOpen(false);
      setBalancePlaintext(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [vault, token, account, depositAmount, encrypt, toast]);

  const handleWithdraw = useCallback(async () => {
    if (!vault || !account) return;
    const amount = withdrawAmount.trim();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.warning("Invalid amount", "Enter a positive number.");
      return;
    }
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      const { Encryptable } = await import("@cofhe/sdk");
      const encrypted = await encrypt([Encryptable.uint64(BigInt(amount))]);
      if (!encrypted) throw new Error("Encryption failed");

      const tx = await vault.withdraw(CONTRACTS.ConfidentialToken, encrypted[0]);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      toast.success(
        "Withdrawal submitted",
        `Up to ${amount} ${TOKEN_CONFIG.symbol} will leave the vault (zero-replaced if balance insufficient — no leak).`,
      );
      setWithdrawAmount("");
      setWithdrawOpen(false);
      setBalancePlaintext(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [vault, account, withdrawAmount, encrypt, toast]);

  const handleRequestProof = useCallback(async () => {
    if (!por || !vault || !account) return;
    const t = thresholdInput.trim();
    if (!t || isNaN(Number(t)) || Number(t) <= 0) {
      toast.warning("Invalid threshold", "Enter a positive number.");
      return;
    }
    setTxState("signing");
    setTxError(undefined);
    setTxHash(undefined);

    try {
      // Step 1 (idempotent): delegate vault balance read to the PoR contract.
      // Required because PoR reads caller's encrypted balance from the vault.
      const delegateTx = await vault.delegateBalanceRead(
        CONTRACTS.ProofOfReserves,
        CONTRACTS.ConfidentialToken,
      );
      await delegateTx.wait();

      // Step 2: request proof
      const tx = await por.requestProof(CONTRACTS.ConfidentialToken, BigInt(t));
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      toast.success(
        "Proof requested",
        "Claim pending Threshold Network reveal. Anyone can finalize via the Reveal button.",
      );
      setThresholdInput("");
      setPorOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      handleTxError(err);
    }
  }, [por, vault, account, thresholdInput, toast]);

  const handleRevealClaim = useCallback(
    async (claimId: number, encResultHandle: string) => {
      if (!por) return;
      try {
        toast.info("Fetching TN signature", "Talking to Threshold Network for verifiable result.");
        const result = await decryptForTx(encResultHandle);
        if (!result) throw new Error("Decryption failed");
        const { decryptedValue, signature } = result;

        setTxState("signing");
        const tx = await por.revealProof(claimId, decryptedValue, signature);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        toast.success(
          "Proof revealed",
          decryptedValue === BigInt(1)
            ? "Verified ≥ threshold. Public proof recorded."
            : "Verified < threshold. Public proof recorded.",
        );
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        handleTxError(err);
      }
    },
    [por, decryptForTx, toast],
  );

  /* ─── Helpers ─── */
  const explorerUrl = (addr: string) => `${FHENIX_TESTNET.blockExplorer}/address/${addr}`;
  const formatTs = (ts: number) =>
    ts === 0 ? "—" : new Date(ts * 1000).toLocaleString();

  /* ─── Render ─── */
  if (!vaultDeployed) {
    return (
      <main className="max-w-container mx-auto px-6 py-16">
        <ComingSoonBanner feature="Treasury Dashboard" redirectHref="/" redirectLabel="Back home" />
      </main>
    );
  }

  return (
    <main className="max-w-container mx-auto px-6 py-12 md:py-16 space-y-16">
      {/* HEADER */}
      <header className="space-y-4">
        <SectionLabel>TREASURY</SectionLabel>
        <h1 className="display">
          Your encrypted <em>treasury</em>, in one view.
        </h1>
        <p className="body-lg max-w-2xl">
          One sealed vault. Every balance, every commitment, every public proof of reserve —
          computed on ciphertext, revealed only to you.
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

      {/* SECTION 1 — ENCRYPTED BALANCE */}
      <section className="space-y-6">
        <div className="flex items-baseline justify-between">
          <SectionLabel>ENCRYPTED BALANCE</SectionLabel>
          <span className="mono text-textMuted">{TOKEN_CONFIG.symbol}</span>
        </div>

        <Card>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-2">
              <div className="mono text-textMuted">Vault holdings · {TOKEN_CONFIG.symbol}</div>
              <div className="font-display text-5xl font-bold tracking-tight">
                {balancePlaintext !== null ? (
                  <>
                    {formatAmount(BigInt(balancePlaintext), 0)}
                    <span className="text-textMuted text-2xl ml-2 font-body font-normal">
                      {TOKEN_CONFIG.symbol}
                    </span>
                  </>
                ) : (
                  <span className="text-textMuted inline-flex items-center gap-3">
                    <Lock className="w-7 h-7" /> Sealed
                  </span>
                )}
              </div>
              <div className="text-textMuted text-sm">
                {balancePlaintext !== null
                  ? "Only you can see this. Re-seal by leaving the page."
                  : "Your balance is encrypted on-chain. Unseal locally with a one-time permit."}
              </div>
            </div>

            <div className="flex gap-2">
              {balancePlaintext === null ? (
                <Button
                  onClick={handleUnsealBalance}
                  loading={unsealing}
                  disabled={!encBalanceHandle || unsealing}
                  leftIcon={<Eye className="w-3 h-3" />}
                >
                  Unseal
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setBalancePlaintext(null)}>
                  Re-seal
                </Button>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* SECTION 2 — QUICK ACTIONS */}
      <section className="space-y-6">
        <SectionLabel>QUICK ACTIONS</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <div className="space-y-3">
              <ArrowDownToLine className="w-5 h-5 text-text" />
              <h3 className="heading-sm">Deposit</h3>
              <p className="text-textSecondary text-sm">
                Move {TOKEN_CONFIG.symbol} from your wallet into the encrypted vault.
              </p>
              <Button size="sm" onClick={() => setDepositOpen(true)}>
                Deposit
              </Button>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <ArrowUpFromLine className="w-5 h-5 text-text" />
              <h3 className="heading-sm">Withdraw</h3>
              <p className="text-textSecondary text-sm">
                Move {TOKEN_CONFIG.symbol} from the vault back to your wallet. Zero-replaced if
                insufficient — no leak.
              </p>
              <Button size="sm" variant="outline" onClick={() => setWithdrawOpen(true)}>
                Withdraw
              </Button>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <Send className="w-5 h-5 text-text" />
              <h3 className="heading-sm">Send</h3>
              <p className="text-textSecondary text-sm">
                Encrypted payroll splits to one or many recipients in a single transaction.
              </p>
              <Link href="/payments" className="btn btn-outline btn-sm">
                Open Payments
              </Link>
            </div>
          </Card>
        </div>
      </section>

      {/* SECTION 3 — PROOF OF RESERVES */}
      <section className="space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <SectionLabel>PROOF OF RESERVES</SectionLabel>
          {porDeployed && (
            <Button size="sm" leftIcon={<Plus className="w-3 h-3" />} onClick={() => setPorOpen(true)}>
              New proof
            </Button>
          )}
        </div>

        <Card>
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-accent2" />
              <h3 className="heading-sm">
                Publicly prove "I hold ≥ X" without revealing your balance.
              </h3>
            </div>
            <p className="text-textSecondary">
              Your encrypted vault balance never decrypts. FHE compares it against a chosen
              threshold; only the boolean outcome is revealed, signed by Fhenix's Threshold Network.
              Auditors, investors, and counterparties see proof — never your books.
            </p>
          </div>
        </Card>

        {!porDeployed ? (
          <Card noHover>
            <p className="text-textMuted">ProofOfReserves not deployed on this network yet.</p>
          </Card>
        ) : loadingClaims ? (
          <Card noHover>
            <p className="text-textMuted">Loading claims…</p>
          </Card>
        ) : claims.length === 0 ? (
          <Card noHover>
            <div className="space-y-2">
              <p className="text-textMuted">No proofs requested yet.</p>
              <p className="text-textSecondary text-sm">
                Use <strong>New proof</strong> to generate your first verifiable threshold proof.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {claims.map((c) => (
              <ClaimRow
                key={c.id}
                claim={c}
                onReveal={(handle) => handleRevealClaim(c.id, handle)}
                porRead={porRead}
                formatTs={formatTs}
                tokenSymbol={TOKEN_CONFIG.symbol}
                explorerUrl={explorerUrl}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECTION 4 — PRIVACY LENS (driven by Navbar mode toggle) */}
      <section className="space-y-6">
        <SectionLabel>PRIVACY LENS</SectionLabel>
        <p className="text-textSecondary max-w-2xl">
          Toggle the lens in the navbar to see this account from three perspectives —
          <strong> Me / Counterparty / Observer</strong> — and watch which values stay sealed.
        </p>
        <PrivacyLens
          title="Treasury account · live"
          rows={[
            {
              label: "Wallet address",
              meValue: account ? `${account.slice(0, 10)}…${account.slice(-6)}` : "—",
              counterpartyValue: account ? `${account.slice(0, 10)}…${account.slice(-6)}` : "—",
              observerValue: account ? `${account.slice(0, 10)}…${account.slice(-6)}` : "—",
              encrypted: false,
            },
            {
              label: "Vault balance",
              meValue:
                balancePlaintext !== null
                  ? `${balancePlaintext} ${TOKEN_CONFIG.symbol}`
                  : "Unseal above to view",
              counterpartyValue: "🔒 sealed (use Proof of Reserves to attest a threshold)",
              observerValue: encBalanceHandle
                ? `${encBalanceHandle.slice(0, 12)}…${encBalanceHandle.slice(-8)}`
                : "🔒 sealed",
              encrypted: true,
            },
            {
              label: "Active proof of reserves",
              meValue: claims.length === 0 ? "None yet" : `${claims.length} claim${claims.length === 1 ? "" : "s"}`,
              counterpartyValue: claims.length === 0 ? "None yet" : `${claims.length} verified threshold proof${claims.length === 1 ? "" : "s"}`,
              observerValue: claims.length === 0 ? "None" : `${claims.length} public claim record${claims.length === 1 ? "" : "s"}`,
              encrypted: false,
            },
            {
              label: "Highest verified threshold",
              meValue:
                claims.find((c) => c.status === 1)?.threshold.toString() ??
                "No verified-true claim yet",
              counterpartyValue:
                claims.find((c) => c.status === 1)?.threshold.toString() ??
                "No verified-true claim yet",
              observerValue:
                claims.find((c) => c.status === 1)?.threshold.toString() ??
                "—",
              encrypted: false,
            },
          ]}
        />
      </section>

      {/* TX STATUS — bottom floating */}
      {txState !== "idle" && (
        <div className="fixed bottom-6 right-6 max-w-sm z-40">
          <TransactionStatus
            state={txState}
            txHash={txHash}
            error={txError}
            onDismiss={() => setTxState("idle")}
          />
        </div>
      )}

      {/* ENCRYPTION PROGRESS — overlay while encrypting */}
      {encrypting && (
        <div className="fixed inset-0 bg-bg/70 backdrop-blur z-50 flex items-center justify-center">
          <Card className="max-w-md" noHover>
            <EncryptionProgress stage={stage} visible={encrypting} />
          </Card>
        </div>
      )}

      {/* DEPOSIT MODAL */}
      {depositOpen && (
        <Modal title="Deposit to vault" subtitle="Move tokens from wallet into encrypted vault." onClose={() => setDepositOpen(false)} {...modalProps}>
          <div className="space-y-4">
            <label className="block">
              <div className="mono text-textMuted mb-2">AMOUNT · {TOKEN_CONFIG.symbol}</div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="100"
                className="w-full px-3 py-2 border border-borderDash rounded bg-bgCard text-text focus:outline-none focus:border-text"
                style={{ borderStyle: "dashed" }}
              />
            </label>
            <p className="text-textMuted text-sm">
              Your amount is encrypted client-side before submission. Public observer sees only
              that a deposit happened.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setDepositOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleDeposit} loading={encrypting || txState === "signing" || txState === "confirming"}>
                Encrypt &amp; Deposit
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* WITHDRAW MODAL */}
      {withdrawOpen && (
        <Modal title="Withdraw from vault" subtitle="Move tokens out. Zero-replaced if insufficient." onClose={() => setWithdrawOpen(false)} {...modalProps}>
          <div className="space-y-4">
            <label className="block">
              <div className="mono text-textMuted mb-2">AMOUNT · {TOKEN_CONFIG.symbol}</div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="100"
                className="w-full px-3 py-2 border border-borderDash rounded bg-bgCard text-text focus:outline-none focus:border-text"
                style={{ borderStyle: "dashed" }}
              />
            </label>
            <p className="text-textMuted text-sm">
              If your balance is below the amount, the contract transfers 0 instead of reverting —
              your insufficient state never leaks.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setWithdrawOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleWithdraw} loading={encrypting || txState === "signing" || txState === "confirming"}>
                Encrypt &amp; Withdraw
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* PROOF OF RESERVES MODAL */}
      {porOpen && (
        <Modal title="Generate proof of reserves" subtitle="Publicly attest you hold at least N tokens — without revealing how much you actually hold." onClose={() => setPorOpen(false)} {...modalProps}>
          <div className="space-y-4">
            <label className="block">
              <div className="mono text-textMuted mb-2">THRESHOLD · {TOKEN_CONFIG.symbol}</div>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                placeholder="1000"
                className="w-full px-3 py-2 border border-borderDash rounded bg-bgCard text-text focus:outline-none focus:border-text"
                style={{ borderStyle: "dashed" }}
              />
            </label>
            <p className="text-textMuted text-sm">
              The threshold itself is public (it's your claim). Your actual balance stays encrypted
              forever. Two transactions: request now, then anyone can call <em>Reveal</em> after the
              Threshold Network signs the result.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setPorOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRequestProof} loading={txState === "signing" || txState === "confirming"}>
                Request proof
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

/* ─── Sub-components ─── */

function Modal({
  title,
  subtitle,
  onClose,
  children,
  ...rest
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  [k: string]: unknown;
}) {
  return (
    <div className="fixed inset-0 bg-text/30 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="editorial-card max-w-lg w-full bg-bgCard"
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        <div className="space-y-1 mb-6">
          <h2 id="treasury-modal-title" className="heading-sm">
            {title}
          </h2>
          {subtitle && <p className="text-textMuted text-sm">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function ClaimRow({
  claim,
  onReveal,
  porRead,
  formatTs,
  tokenSymbol,
  explorerUrl,
}: {
  claim: Claim;
  onReveal: (encResultHandle: string) => void;
  porRead: ReturnType<typeof useReadContract>;
  formatTs: (ts: number) => string;
  tokenSymbol: string;
  explorerUrl: (addr: string) => string;
}) {
  const [encResultHandle, setEncResultHandle] = useState<string | null>(null);

  // For pending claims, fetch the encResult handle from the public claims() mapping.
  useEffect(() => {
    if (claim.status !== 0 || !porRead) return;
    let active = true;
    (async () => {
      try {
        // Public mapping `claims(id)` returns full struct including encResult (index 6)
        const c = await porRead.claims(claim.id);
        if (active) setEncResultHandle(c[6].toString());
      } catch {
        /* silent */
      }
    })();
    return () => {
      active = false;
    };
  }, [claim.id, claim.status, porRead]);

  const StatusBadge =
    claim.status === 1 ? (
      <span className="badge inline-flex items-center gap-1 text-success">
        <CheckCircle2 className="w-3 h-3" /> VERIFIED ≥
      </span>
    ) : claim.status === 2 ? (
      <span className="badge inline-flex items-center gap-1 text-danger">
        <XCircle className="w-3 h-3" /> VERIFIED &lt;
      </span>
    ) : (
      <span className="badge inline-flex items-center gap-1 text-textMuted">
        <Clock className="w-3 h-3" /> PENDING
      </span>
    );

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            {StatusBadge}
            <span className="mono text-textMuted">#{claim.id}</span>
          </div>
          <div className="font-display text-2xl">
            ≥ {claim.threshold.toString()} <span className="text-textMuted text-base">{tokenSymbol}</span>
          </div>
          <div className="text-textMuted text-sm">
            Requested {formatTs(claim.requestedAt)}
            {claim.revealedAt > 0 && <> · Revealed {formatTs(claim.revealedAt)}</>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {claim.status === 0 && encResultHandle && (
            <Button size="sm" onClick={() => onReveal(encResultHandle)}>
              Reveal via TN
            </Button>
          )}
          <a
            href={explorerUrl(claim.prover)}
            target="_blank"
            rel="noreferrer"
            className="mono text-textMuted hover:text-text inline-flex items-center gap-1"
          >
            View prover <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </Card>
  );
}
