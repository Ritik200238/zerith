"use client";

export const dynamic = "force-dynamic";

/**
 * Allowlist Gate — /allowlist
 *
 * Merkle-tree allowlist for gated participation. Creator builds a tree
 * off-chain from a list of addresses, posts the root on-chain. Users
 * submit a Merkle proof to claim/verify.
 *
 * For demo: includes a built-in client-side Merkle tree builder so
 * a creator can paste addresses, get a root, and post it. Users can
 * then look up the proof for their address.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListChecks, Plus, X, Loader2, RefreshCw, CheckCircle2, AlertCircle,
  Tag, Trees, Search, Power,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { useContract, useReadContract } from "@/hooks/useContract";
import { useBlockPoll, useAccountChangeReset } from "@/hooks/useBlockPoll";
import { useToast, useModalEscape } from "@/components/shared/Toast";
import { useTxFeedback } from "@/hooks/useTxFeedback";
import { TransactionStatus, type TxState } from "@/components/shared/TransactionStatus";
import { EmptyState } from "@/components/shared/EmptyState";
import { FaucetButton } from "@/components/shared/FaucetButton";
import { ComingSoonBanner } from "@/components/shared/ComingSoonBanner";
import { CONTRACTS } from "@/lib/constants";
import { isValidAddress, shortAddress } from "@/lib/format";

interface AllowlistData {
  id: number;
  merkleRoot: string;
  creator: string;
  active: boolean;
  description: string;
}

/* ---------------------------------------------------------------- */
/* Minimal Merkle tree (sorted-pair hashing, MerkleProof-compatible) */
/* ---------------------------------------------------------------- */

function leafHash(addr: string): string {
  // contract uses keccak256(abi.encodePacked(user)) — single 20-byte address
  return ethers.keccak256(ethers.solidityPacked(["address"], [addr]));
}

function pairHash(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

function buildMerkle(addresses: string[]): { root: string; proofs: Record<string, string[]> } {
  const leaves = addresses.map(leafHash);
  if (leaves.length === 0) return { root: ethers.ZeroHash, proofs: {} };
  if (leaves.length === 1) return { root: leaves[0], proofs: { [addresses[0].toLowerCase()]: [] } };

  // Build tree levels
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(pairHash(current[i], current[i + 1]));
      } else {
        next.push(current[i]); // odd one out, carry up
      }
    }
    levels.push(next);
    current = next;
  }

  // For each leaf, walk up collecting siblings
  const proofs: Record<string, string[]> = {};
  addresses.forEach((addr, idx) => {
    const proof: string[] = [];
    let pos = idx;
    for (let lv = 0; lv < levels.length - 1; lv++) {
      const level = levels[lv];
      const siblingPos = pos % 2 === 0 ? pos + 1 : pos - 1;
      if (siblingPos < level.length) proof.push(level[siblingPos]);
      pos = Math.floor(pos / 2);
    }
    proofs[addr.toLowerCase()] = proof;
  });

  return { root: levels[levels.length - 1][0], proofs };
}

/* ---------------------------------------------------------------- */

type ModalView = "none" | "create" | "lookup" | "claim";

export default function AllowlistPage() {
  const { account } = useWallet();
  const toast = useToast();

  const allowlistContract = useContract("AllowlistGate");
  const allowlistRead = useReadContract("AllowlistGate");

  const deployed = CONTRACTS.AllowlistGate !== "0x0000000000000000000000000000000000000000";

  const [allowlists, setAllowlists] = useState<AllowlistData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalView, setModalView] = useState<ModalView>("none");
  const [selectedList, setSelectedList] = useState<AllowlistData | null>(null);

  // create form
  const [description, setDescription] = useState("");
  const [addressesText, setAddressesText] = useState("");

  // lookup form
  const [lookupAddr, setLookupAddr] = useState("");
  const [lookupResult, setLookupResult] = useState<{ root: string; proof: string[] } | null>(null);

  // claim form (active allowlist, user provides proof)
  const [claimProofText, setClaimProofText] = useState(""); // JSON or comma-separated bytes32s

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  useTxFeedback(txState, { label: "Allowlist", type: "system", href: "/allowlist", txHash });

  const modalProps = useModalEscape(modalView !== "none", () => setModalView("none"), "allowlist-modal-title");

  /* ---- compute root + proofs from addressesText ---- */

  const parsed = useMemo(() => {
    const lines = addressesText
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const validAddrs = lines.filter(isValidAddress);
    if (validAddrs.length === 0) return null;
    return { addresses: validAddrs, ...buildMerkle(validAddrs) };
  }, [addressesText]);

  /* ---- fetch ---- */

  const fetchAllowlists = useCallback(async () => {
    if (!allowlistRead) return;
    try {
      const count = Number(await allowlistRead.nextAllowlistId());
      const indices = Array.from({ length: count }, (_, i) => i);
      const raws = await Promise.all(
        indices.map((i) => allowlistRead.getAllowlist(i).catch(() => null)),
      );
      const out: AllowlistData[] = [];
      raws.forEach((a, i) => {
        if (!a) return;
        out.push({
          id: i,
          merkleRoot: a[0],
          creator: a[1],
          active: a[2],
          description: a[3],
        });
      });
      setAllowlists(out.reverse());
    } catch {
      /* noop */
    }
  }, [allowlistRead]);

  const blockTick = useBlockPoll();
  useEffect(() => {
    if (deployed) fetchAllowlists();
  }, [fetchAllowlists, refreshKey, blockTick, deployed]);
  useAccountChangeReset(useCallback(() => setRefreshKey((k) => k + 1), []));

  /* ---- actions ---- */

  const handleCreate = useCallback(async () => {
    if (!allowlistContract) return;
    if (!parsed || parsed.addresses.length === 0) {
      toast.error("No valid addresses", "Paste at least one valid 0x address");
      return;
    }
    if (!description) {
      toast.error("Description required", "Add a label for the allowlist");
      return;
    }
    setTxState("signing");
    try {
      const tx = await allowlistContract.createAllowlist(parsed.root, description);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setDescription("");
      setAddressesText("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Create failed", msg);
    }
  }, [allowlistContract, parsed, description, toast]);

  /** Parse a proof either from JSON array or comma-separated bytes32s. */
  const parseProofInput = (raw: string): string[] | null => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // Try JSON first
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string" && /^0x[0-9a-fA-F]{64}$/.test(p))) {
        return parsed;
      }
    } catch {
      /* fall through */
    }
    // Comma / whitespace separated
    const parts = trimmed
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.every((p) => /^0x[0-9a-fA-F]{64}$/.test(p))) return parts;
    return null;
  };

  /** For inactive allowlists, empty proof works (contract returns true unconditionally). */
  const handleVerifyOpen = useCallback(
    async (al: AllowlistData) => {
      if (!allowlistContract || !account) return;
      setTxState("signing");
      try {
        const tx = await allowlistContract.verifyAndMark(al.id, account, []);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Verify failed", msg);
      }
    },
    [allowlistContract, account, toast],
  );

  /** For active allowlists, user submits their proof + claims in one tx. */
  const handleClaimWithProof = useCallback(async () => {
    if (!allowlistContract || !account || !selectedList) return;
    const proof = parseProofInput(claimProofText);
    if (proof === null) {
      toast.error("Invalid proof", "Provide a JSON array or comma-separated bytes32 hex values");
      return;
    }
    setTxState("signing");
    try {
      const tx = await allowlistContract.verifyAndMark(selectedList.id, account, proof);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setClaimProofText("");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Claim failed", msg);
    }
  }, [allowlistContract, account, selectedList, claimProofText, toast]);

  /**
   * Convenience: if the user has the full address list (in the Lookup textarea)
   * and looks up their own address, this auto-runs verifyAndMark with the
   * generated proof — fully on-page end-to-end claim.
   */
  const handleAutoClaim = useCallback(async () => {
    if (!allowlistContract || !account || !selectedList) return;
    if (!parsed) {
      toast.error("Build the tree first", "Paste the original address list in the modal");
      return;
    }
    const proof = parsed.proofs[account.toLowerCase()];
    if (!proof) {
      toast.error("Not in list", "Your address is not in the pasted allowed list");
      return;
    }
    if (parsed.root.toLowerCase() !== selectedList.merkleRoot.toLowerCase()) {
      toast.error("Root mismatch", "Pasted list produces a different root than the on-chain allowlist");
      return;
    }
    setTxState("signing");
    try {
      const tx = await allowlistContract.verifyAndMark(selectedList.id, account, proof);
      setTxState("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("success");
      setModalView("none");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setTxState("error");
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
      setTxError(msg);
      toast.error("Auto-claim failed", msg);
    }
  }, [allowlistContract, account, selectedList, parsed, toast]);

  const handleDeactivate = useCallback(
    async (al: AllowlistData) => {
      if (!allowlistContract) return;
      setTxState("signing");
      try {
        const tx = await allowlistContract.deactivate(al.id);
        setTxState("confirming");
        setTxHash(tx.hash);
        await tx.wait();
        setTxState("success");
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        setTxState("error");
        const msg = err instanceof Error ? err.message.slice(0, 200) : "Failed";
        setTxError(msg);
        toast.error("Deactivate failed", msg);
      }
    },
    [allowlistContract, toast],
  );

  const handleLookup = useCallback(() => {
    if (!parsed) {
      toast.error("Build tree first", "Paste addresses to build the Merkle tree");
      return;
    }
    if (!isValidAddress(lookupAddr)) {
      toast.error("Invalid address", "Paste a valid 0x address");
      return;
    }
    const proof = parsed.proofs[lookupAddr.toLowerCase()];
    if (!proof) {
      toast.error("Not in tree", "This address is not in the address list above");
      return;
    }
    setLookupResult({ root: parsed.root, proof });
  }, [parsed, lookupAddr, toast]);

  if (!deployed) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 md:px-10 py-12 md:py-16 font-body" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ComingSoonBanner feature="Allowlist Gate" shipDate="soon" />
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
          — Allowlist gate
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <h1
              className="font-display font-bold tracking-tight leading-[1.02] mb-4"
              style={{ fontSize: "clamp(38px, 5vw, 64px)", letterSpacing: "-0.04em" }}
            >
              Merkle whitelist.{" "}<em className="font-serif italic font-normal">Gated participation</em>.
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.6 }}>
              Gate access via an on-chain Merkle root; membership is proven off-chain — the root reveals nothing about who is on the list.
            </p>
          </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FaucetButton />
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh"
            className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-bgCard transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setModalView("create")} disabled={!account}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium
                       bg-text from-[var(--text)] to-[var(--text)]
                       text-[var(--bg)] hover:shadow-lg disabled:opacity-40 transition-all">
            <Plus size={14} /> New allowlist
          </button>
          <button onClick={() => setModalView("lookup")}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-colors">
            <Search size={14} /> Lookup proof
          </button>
        </div>
      </div>
        </header>

      <TransactionStatus state={txState} txHash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      <section className="mt-6 grid gap-3">
        {allowlists.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            eyebrow="No allowlists yet"
            title="Gate participation to a known set of addresses."
            body="Foundations selling to institutions can't let unknown wallets into a $50M round. Allowlists publish a Merkle root on-chain; participants prove membership with an off-chain proof. The root commits to the set without revealing who is on it — a gated feature only accepts callers whose proof verifies."
            primary={{ label: "Create allowlist", onClick: () => setModalView("create") }}
            secondary={{ label: "First time? Run the quickstart", href: "/quickstart" }}
          />
        ) : (
          allowlists.map((a) => {
            const isMine = account && a.creator.toLowerCase() === account.toLowerCase();
            return (
              <article key={a.id} style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: 4 }} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">#{a.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      a.active ? "bg-[var(--bg-alt)] text-[var(--text)]" : "bg-bgAlt text-[var(--text-muted)]"
                    }`}>{a.active ? "GATED · proof required" : "OPEN · gate disabled"}</span>
                    {isMine && <span className="text-[10px] text-[var(--text)]">yours</span>}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">creator {shortAddress(a.creator)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Tag size={12} className="text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text)]">{a.description || "(no description)"}</span>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--text-muted)] truncate">
                  root: {a.merkleRoot.slice(0, 14)}…{a.merkleRoot.slice(-10)}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {a.active && account && (
                    <button onClick={() => { setSelectedList(a); setModalView("claim"); }}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <CheckCircle2 size={11} /> Claim with proof
                    </button>
                  )}
                  {!a.active && account && (
                    <button onClick={() => handleVerifyOpen(a)}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <CheckCircle2 size={11} /> Claim (gate disabled — no proof needed)
                    </button>
                  )}
                  {isMine && a.active && (
                    <button onClick={() => handleDeactivate(a)}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text-muted)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Power size={11} /> Deactivate
                    </button>
                  )}
                  {isMine && (
                    <button onClick={() => { setSelectedList(a); setModalView("lookup"); }}
                      className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-colors">
                      <Trees size={11} /> Generate proof
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      <AnimatePresence>
        {modalView !== "none" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bgAlt backdrop-blur-sm p-4"
            onClick={() => setModalView("none")} {...modalProps}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-dashed border-[var(--border-dash)] rounded w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">

              {modalView === "create" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 id="allowlist-modal-title" className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <ListChecks size={18} className="text-[var(--text)]" /> New allowlist
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Description</label>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="VIP launch round"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Allowed addresses (one per line, comma, or space)</label>
                    <textarea value={addressesText} onChange={(e) => setAddressesText(e.target.value)} rows={6}
                      placeholder="0x...&#10;0x...&#10;0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)] resize-none" />
                  </div>
                  {parsed && (
                    <div className="rounded bg-[var(--bg-alt)]/40 p-2.5 text-xs">
                      <div className="text-[var(--text-muted)]">{parsed.addresses.length} valid addresses</div>
                      <div className="font-mono text-[10px] text-[var(--text)] truncate mt-1">root: {parsed.root}</div>
                    </div>
                  )}
                  <button onClick={handleCreate} disabled={!parsed || !description || txState === "signing" || txState === "confirming"}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium
                               bg-text from-[var(--text)] to-[var(--text)]
                               text-[var(--bg)] hover:shadow-lg transition-all disabled:opacity-50">
                    {txState === "signing" || txState === "confirming"
                      ? <Loader2 size={14} className="animate-spin" />
                      : <CheckCircle2 size={14} />}
                    Create allowlist
                  </button>
                </>
              )}

              {modalView === "claim" && selectedList && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <CheckCircle2 size={18} className="text-[var(--text)]" /> Claim allowlist #{selectedList.id}
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Two ways: paste the original address list to auto-generate your proof, OR paste a pre-computed proof directly.
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Option A — paste full allowed list (auto-proof)</label>
                    <textarea value={addressesText} onChange={(e) => setAddressesText(e.target.value)} rows={4}
                      placeholder="0x...&#10;0x...&#10;0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)] resize-none" />
                    {parsed && account && (
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Computed root: {parsed.root.slice(0, 14)}…
                        {parsed.root.toLowerCase() === selectedList.merkleRoot.toLowerCase() ? (
                          <span className="ml-2 text-[var(--text)]">✓ matches on-chain root</span>
                        ) : (
                          <span className="ml-2 text-[var(--text-muted)]">⚠ does not match on-chain root</span>
                        )}
                      </div>
                    )}
                    <button onClick={handleAutoClaim}
                      disabled={!parsed || txState === "signing" || txState === "confirming"}
                      className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                      {txState === "signing" || txState === "confirming"
                        ? <Loader2 size={12} className="animate-spin" />
                        : <CheckCircle2 size={12} />}
                      Auto-claim from list
                    </button>
                  </div>

                  <div className="h-px bg-[var(--border-dash)] my-2" />

                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Option B — paste pre-computed proof</label>
                    <textarea value={claimProofText} onChange={(e) => setClaimProofText(e.target.value)} rows={4}
                      placeholder='["0x...", "0x..."] or comma-separated'
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)] resize-none" />
                    <button onClick={handleClaimWithProof}
                      disabled={!claimProofText || txState === "signing" || txState === "confirming"}
                      className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium bg-[var(--bg-alt)] text-[var(--text)] hover:bg-[var(--bg-alt)] transition-all disabled:opacity-50">
                      {txState === "signing" || txState === "confirming"
                        ? <Loader2 size={12} className="animate-spin" />
                        : <CheckCircle2 size={12} />}
                      Claim with manual proof
                    </button>
                  </div>
                </>
              )}

              {modalView === "lookup" && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--text)]">
                      <Search size={18} className="text-[var(--text)]" /> Generate Merkle proof
                    </h3>
                    <button onClick={() => setModalView("none")} aria-label="Close modal" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-bgCard">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">All allowed addresses</label>
                    <textarea value={addressesText} onChange={(e) => setAddressesText(e.target.value)} rows={5}
                      placeholder="paste original allowed list here"
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)] resize-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--text-muted)] font-medium">Address to lookup</label>
                    <input value={lookupAddr} onChange={(e) => setLookupAddr(e.target.value)} placeholder="0x..."
                      className="w-full bg-[var(--bg-alt)] rounded px-3 py-2 text-[11px] font-mono text-[var(--text)] outline-none focus:ring-1 ring-[var(--text)]" />
                  </div>
                  <button onClick={handleLookup}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-medium bg-[var(--text)]/15 text-[var(--text)] hover:bg-[var(--text)]/25 transition-all">
                    <Search size={14} /> Generate proof
                  </button>
                  {lookupResult && (
                    <div className="rounded bg-[var(--bg-alt)] border border-[var(--border-dash)] p-3 text-xs space-y-2">
                      <div className="flex items-center gap-2 text-[var(--text)] font-medium">
                        <CheckCircle2 size={14} /> Proof generated
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">root: {lookupResult.root}</div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        proof: [{lookupResult.proof.length === 0 ? "empty (single-leaf tree)" : lookupResult.proof.map(p => `${p.slice(0,10)}…`).join(", ")}]
                      </div>
                      <p className="text-[10px] text-[var(--text-secondary)]">
                        Pass this proof array to <code>verifyAndMark</code> via the contract directly or another allowlist-gated feature.
                      </p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
