"use client";

// Side-effect: registers Reown AppKit globally on the client. Must import
// before the AppKit hooks below resolve to anything useful.
import "@/lib/appkit";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ethers } from "ethers";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
  useDisconnect as useAppKitDisconnect,
} from "@reown/appkit/react";
import { sepolia } from "@reown/appkit/networks";
import { FHENIX_TESTNET } from "@/lib/constants";

/* ---------- Types ---------- */

export type WalletMode = "disconnected" | "injected" | "burner";

interface WalletState {
  /** Currently connected account address (null if disconnected) */
  account: string | null;
  /** ethers provider — BrowserProvider (injected) or JsonRpcProvider (burner) */
  provider: ethers.Provider | null;
  /** ethers signer — JsonRpcSigner (injected) or Wallet (burner) */
  signer: ethers.Signer | null;
  /** Whether the wallet is on the correct chain */
  isCorrectChain: boolean;
  /** Whether a connection attempt is in progress */
  connecting: boolean;
  /** Last wallet error message */
  error: string | null;
  /** Active mode */
  mode: WalletMode;
  /**
   * Burner private key, ONLY populated when mode === "burner".
   * Used by the export-key UI. Never logged. Never sent over the network
   * (the user manually copies it from the export modal if they want to keep it).
   */
  burnerPrivateKey: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  connectBurner: (opts: { privateKey: string; address?: string }) => Promise<void>;
  /**
   * Create a fresh burner via /api/burner/create and connect it.
   * Returns the funding tx hash for UI confirmation.
   */
  createAndConnectBurner: () => Promise<{ address: string; fundedTxHash: string }>;
  disconnect: () => void;
  switchToFhenix: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/* ---------- Storage ---------- */

const BURNER_STORAGE_KEY = "zerith-burner-v1";

interface StoredBurner {
  privateKey: string;
  address: string;
  createdAt: number;
}

function loadStoredBurner(): StoredBurner | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BURNER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBurner;
    if (!parsed.privateKey || !parsed.address) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredBurner(burner: StoredBurner): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BURNER_STORAGE_KEY, JSON.stringify(burner));
  } catch {
    // localStorage unavailable (private mode, quota). Burner still works
    // in-memory but won't persist across reloads. Not fatal.
  }
}

function clearStoredBurner(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BURNER_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ---------- Provider ---------- */

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [isCorrectChain, setIsCorrectChain] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WalletMode>("disconnected");
  const [burnerPrivateKey, setBurnerPrivateKey] = useState<string | null>(null);

  // Mirror of `mode` in a ref so the AppKit subscription effect can read
  // the latest value without re-running every time mode changes.
  const modeRef = useRef<WalletMode>("disconnected");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Synchronous flag set the instant a burner is activated. `setMode("burner")`
  // is async (batched), so on first render modeRef can still read "disconnected"
  // while AppKit auto-reconnect fires — letting the sync effect clobber a just-
  // restored burner. This ref flips immediately inside activateBurner, before
  // any state flush, so the AppKit sync guard can see the burner is live.
  const burnerActiveRef = useRef(false);

  // Tracks the last account we dispatched a change event for. Declared here
  // (above activateBurner) so the burner path can compare/update it directly;
  // the AppKit address-changed effect below also reads/writes it.
  const prevAccountRef = useRef<string | null>(null);

  /* ---- Reown AppKit hooks (only meaningful when mode !== "burner") ---- */
  const { open: openAppKitModal } = useAppKit();
  const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount();
  const { chainId: appKitChainId, switchNetwork } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<ethers.Eip1193Provider>("eip155");
  const { disconnect: appKitDisconnect } = useAppKitDisconnect();

  /* ---- Helpers ---- */

  const activateBurner = useCallback((privateKey: string, address: string) => {
    // Flip the synchronous guard FIRST, before any (batched/async) state set,
    // so a concurrent AppKit auto-reconnect can't clobber this burner.
    burnerActiveRef.current = true;
    modeRef.current = "burner";

    // If we're switching from one burner identity to a different one, the prior
    // identity's account-scoped state (unsealed amounts, cached handles) must be
    // flushed — otherwise it leaks across burner identities. The burner path
    // never goes through the AppKit address-changed effect, so dispatch here.
    const prevAccount = prevAccountRef.current;
    const switchedIdentity =
      typeof window !== "undefined" &&
      prevAccount !== null &&
      prevAccount.toLowerCase() !== address.toLowerCase();
    prevAccountRef.current = address;

    const rpc = new ethers.JsonRpcProvider(FHENIX_TESTNET.rpcUrl, FHENIX_TESTNET.chainId);
    const wallet = new ethers.Wallet(privateKey, rpc);
    setProvider(rpc);
    setSigner(wallet);
    setAccount(address);
    setIsCorrectChain(true);
    setMode("burner");
    setBurnerPrivateKey(privateKey);
    setError(null);

    if (switchedIdentity) {
      window.dispatchEvent(
        new CustomEvent("zerith-account-changed", { detail: address }),
      );
    }
  }, []);

  /* ---- Initialize: restore burner if present (takes priority over AppKit) ---- */
  useEffect(() => {
    const stored = loadStoredBurner();
    if (stored) {
      try {
        activateBurner(stored.privateKey, stored.address);
      } catch {
        // Corrupted privkey — clear and fall through to AppKit (no auto-connect).
        clearStoredBurner();
      }
    }
  }, [activateBurner]);

  /* ---- Sync AppKit state -> ethers signer (skipped while burner is active) ---- */
  useEffect(() => {
    // burnerActiveRef is the synchronous source of truth: on first render an
    // AppKit auto-reconnect can fire before setMode("burner") flushes, so
    // modeRef may still read "disconnected" here. Checking the ref prevents
    // this effect from clobbering a just-restored burner signer.
    if (burnerActiveRef.current || modeRef.current === "burner") return;

    if (!appKitConnected || !walletProvider || !appKitAddress) {
      // AppKit reports disconnected. If we were previously injected, clear.
      if (modeRef.current === "injected") {
        setAccount(null);
        setSigner(null);
        setProvider(null);
        setIsCorrectChain(false);
        setMode("disconnected");
      }
      return;
    }

    let cancelled = false;
    const prov = new ethers.BrowserProvider(walletProvider);
    prov
      .getSigner()
      .then((s) => {
        if (cancelled) return;
        setProvider(prov);
        setSigner(s);
        setAccount(appKitAddress);
        setMode("injected");
        setIsCorrectChain(Number(appKitChainId) === FHENIX_TESTNET.chainId);
        setError(null);
        // Connection resolved — release the spinner started by connect().
        setConnecting(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSigner(null);
        setConnecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appKitConnected, appKitAddress, appKitChainId, walletProvider]);

  /* ---- Fire legacy account-changed event so per-account hooks can reset ---- */
  // useBlockPoll.ts listens for "zerith-account-changed" to flush per-account
  // cached state on account switch. We dispatch it whenever the AppKit-driven
  // address changes — but not for burner-mode address changes, since burner
  // activation already runs through the disconnect/reconnect cycle (handled
  // synchronously inside activateBurner).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (modeRef.current === "burner") {
      prevAccountRef.current = account;
      return;
    }
    if (appKitAddress && appKitAddress !== prevAccountRef.current) {
      prevAccountRef.current = appKitAddress;
      window.dispatchEvent(
        new CustomEvent("zerith-account-changed", { detail: appKitAddress }),
      );
    }
  }, [appKitAddress, account]);

  /* ---- Connect via Reown wallet picker ---- */
  const connect = useCallback(async () => {
    // If a burner was active, switching to injected should clear it so the
    // AppKit sync effect can drive the new signer state once the user picks.
    if (mode === "burner") {
      // Drop the synchronous burner guard so the AppKit sync effect is allowed
      // to run again once the user picks an injected wallet.
      burnerActiveRef.current = false;
      clearStoredBurner();
      setBurnerPrivateKey(null);
      setMode("disconnected");
    }

    setError(null);
    // Drive the "Connecting…" spinner. Cleared when the AppKit sync effect
    // resolves a signer / errors, or by the safety timeout below if the user
    // dismisses the modal without connecting.
    setConnecting(true);
    try {
      await openAppKitModal();
      // Note: openAppKitModal() resolves when the modal opens, NOT when the
      // user finishes connecting. Real connection state arrives via the
      // useAppKitAccount hook, picked up by the sync effect above.
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to open wallet picker";
      setError(message);
      setConnecting(false);
      return;
    }
    // Safety net: if the user closes the modal without connecting, the sync
    // effect never fires, so release the spinner after a grace period rather
    // than leaving it stuck on forever. A successful connect clears `connecting`
    // first (via the sync effect), making this a no-op.
    setTimeout(() => {
      setConnecting((c) => (c ? false : c));
    }, 60_000);
  }, [mode, openAppKitModal]);

  /* ---- Connect via burner (existing key — restore + manual import) ---- */
  const connectBurner = useCallback(
    async ({ privateKey, address }: { privateKey: string; address?: string }) => {
      try {
        // Validate the privkey by constructing a Wallet. Throws on malformed input.
        const probe = new ethers.Wallet(privateKey);
        const addr = address ?? probe.address;
        // Tear down any AppKit connection silently — burner takes priority.
        if (appKitConnected) {
          try {
            await appKitDisconnect();
          } catch {
            // Best-effort. If AppKit refuses, the modeRef check still gates
            // the sync effect from clobbering the burner signer.
          }
        }
        activateBurner(privateKey, addr);
        saveStoredBurner({ privateKey, address: addr, createdAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid burner key";
        setError(message);
        throw err;
      }
    },
    [activateBurner, appKitConnected, appKitDisconnect],
  );

  /* ---- Create-and-connect burner (the "Try Instantly" path) ---- */
  const createAndConnectBurner = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // Tear down any AppKit connection silently — burner takes priority.
      if (appKitConnected) {
        try {
          await appKitDisconnect();
        } catch {
          // Best-effort; see connectBurner for the same rationale.
        }
      }
      const resp = await fetch("/api/burner/create", { method: "POST" });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { message?: string } | null;
        const msg = body?.message ?? `Burner creation failed (HTTP ${resp.status})`;
        setError(msg);
        throw new Error(msg);
      }
      const data = (await resp.json()) as {
        address: string;
        privateKey: string;
        fundedTxHash: string;
      };
      activateBurner(data.privateKey, data.address);
      saveStoredBurner({
        privateKey: data.privateKey,
        address: data.address,
        createdAt: Date.now(),
      });
      return { address: data.address, fundedTxHash: data.fundedTxHash };
    } finally {
      setConnecting(false);
    }
  }, [activateBurner, appKitConnected, appKitDisconnect]);

  /* ---- Disconnect ---- */
  const disconnect = useCallback(() => {
    if (mode === "burner") {
      // Release the synchronous burner guard so the AppKit sync effect is free
      // to run again (e.g. if the user later connects an injected wallet).
      burnerActiveRef.current = false;
      prevAccountRef.current = null;
      clearStoredBurner();
      setAccount(null);
      setSigner(null);
      setProvider(null);
      setIsCorrectChain(false);
      setError(null);
      setMode("disconnected");
      setBurnerPrivateKey(null);
      return;
    }

    // Injected path — ask AppKit to drop the session. The hook-driven sync
    // effect will then clear our local signer state on the next tick.
    appKitDisconnect().catch(() => {
      // Even if AppKit's disconnect fails, force-clear local state so the
      // UI doesn't get stuck showing a connected address.
      setAccount(null);
      setSigner(null);
      setProvider(null);
      setIsCorrectChain(false);
      setMode("disconnected");
    });
  }, [mode, appKitDisconnect]);

  /* ---- Switch to Sepolia (Fhenix coprocessor lives here) ---- */
  const switchToFhenix = useCallback(async () => {
    // Burner is constructed against Sepolia RPC; no-op.
    if (mode === "burner") return;

    try {
      await switchNetwork(sepolia);
    } catch {
      setError("Failed to switch to Sepolia network.");
    }
  }, [mode, switchNetwork]);

  /* ---- Context value ---- */
  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      provider,
      signer,
      isCorrectChain,
      connecting,
      error,
      mode,
      burnerPrivateKey,
      connect,
      connectBurner,
      createAndConnectBurner,
      disconnect,
      switchToFhenix,
    }),
    [
      account,
      provider,
      signer,
      isCorrectChain,
      connecting,
      error,
      mode,
      burnerPrivateKey,
      connect,
      connectBurner,
      createAndConnectBurner,
      disconnect,
      switchToFhenix,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/* ---------- Hook ---------- */

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
