"use client";

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

  // Mirror of `mode` in a ref so the long-lived window.ethereum listeners
  // (attached once on mount) can no-op when a burner is active without us
  // having to detach/re-attach across mode switches.
  const modeRef = useRef<WalletMode>("disconnected");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /* ---- Helpers ---- */

  const activateBurner = useCallback((privateKey: string, address: string) => {
    const rpc = new ethers.JsonRpcProvider(FHENIX_TESTNET.rpcUrl, FHENIX_TESTNET.chainId);
    const wallet = new ethers.Wallet(privateKey, rpc);
    setProvider(rpc);
    setSigner(wallet);
    setAccount(address);
    setIsCorrectChain(true);
    setMode("burner");
    setBurnerPrivateKey(privateKey);
    setError(null);
  }, []);

  /* ---- Check chain (injected only) ---- */
  const checkChain = useCallback(async (prov: ethers.BrowserProvider) => {
    try {
      const network = await prov.getNetwork();
      setIsCorrectChain(network.chainId === BigInt(FHENIX_TESTNET.chainId));
    } catch {
      setIsCorrectChain(false);
    }
  }, []);

  /* ---- Initialize from existing connection ---- */
  useEffect(() => {
    // First — try restoring a saved burner. Burner takes priority over an
    // existing injected connection because the user picked "Try instantly"
    // last session and we should respect that.
    const stored = loadStoredBurner();
    if (stored) {
      try {
        activateBurner(stored.privateKey, stored.address);
        return; // don't attach injected listeners while burner is active
      } catch {
        // Corrupted privkey — clear and fall through to injected.
        clearStoredBurner();
      }
    }

    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) return;

    const prov = new ethers.BrowserProvider(ethereum);

    // Check if already connected
    prov
      .listAccounts()
      .then(async (accounts) => {
        if (accounts.length > 0) {
          const s = await prov.getSigner();
          setProvider(prov);
          setSigner(s);
          setAccount(await s.getAddress());
          setMode("injected");
          await checkChain(prov);
        }
      })
      .catch(() => {
        // Not connected — that is fine
      });

    // Listen for account / chain changes. Listeners stay attached for the
    // provider's lifetime; we gate on modeRef so they no-op while a burner
    // is active (otherwise an unrelated MetaMask account-switch event would
    // clobber the burner signer).
    const handleAccountsChanged = (...args: unknown[]) => {
      if (modeRef.current === "burner") return;
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        setSigner(null);
        setIsCorrectChain(false);
        setMode("disconnected");
      } else {
        setAccount(accounts[0]);
        prov.getSigner().then(setSigner).catch(() => setSigner(null));
        window.dispatchEvent(new CustomEvent("sigil-account-changed", { detail: accounts[0] }));
      }
    };

    const handleChainChanged = (...args: unknown[]) => {
      if (modeRef.current === "burner") return;
      const newChainIdHex = args[0] as string;
      const newChainId = parseInt(newChainIdHex, 16);
      setIsCorrectChain(newChainId === FHENIX_TESTNET.chainId);
      const fresh = new ethers.BrowserProvider(ethereum);
      setProvider(fresh);
      fresh.getSigner().then(setSigner).catch(() => setSigner(null));
      window.dispatchEvent(new CustomEvent("sigil-chain-changed", { detail: newChainId }));
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [checkChain, activateBurner]);

  /* ---- Connect (injected MetaMask) ---- */
  const connect = useCallback(async () => {
    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) {
      setError("MetaMask is not installed. Use Try Instantly to demo without a wallet.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      // If a burner was active, switching to injected should clear it.
      if (mode === "burner") {
        clearStoredBurner();
        setBurnerPrivateKey(null);
      }

      const prov = new ethers.BrowserProvider(ethereum);
      await prov.send("eth_requestAccounts", []);
      const s = await prov.getSigner();
      const addr = await s.getAddress();

      setProvider(prov);
      setSigner(s);
      setAccount(addr);
      setMode("injected");
      await checkChain(prov);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
    } finally {
      setConnecting(false);
    }
  }, [checkChain, mode]);

  /* ---- Connect via burner (existing key — used for restore + manual import) ---- */
  const connectBurner = useCallback(
    async ({ privateKey, address }: { privateKey: string; address?: string }) => {
      try {
        // Validate the privkey by constructing a Wallet. Will throw on malformed input.
        const probe = new ethers.Wallet(privateKey);
        const addr = address ?? probe.address;
        activateBurner(privateKey, addr);
        saveStoredBurner({ privateKey, address: addr, createdAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid burner key";
        setError(message);
        throw err;
      }
    },
    [activateBurner],
  );

  /* ---- Create-and-connect burner (the "Try Instantly" path) ---- */
  const createAndConnectBurner = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
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
  }, [activateBurner]);

  /* ---- Disconnect ---- */
  const disconnect = useCallback(() => {
    if (mode === "burner") {
      clearStoredBurner();
    }
    setAccount(null);
    setSigner(null);
    setProvider(null);
    setIsCorrectChain(false);
    setError(null);
    setMode("disconnected");
    setBurnerPrivateKey(null);
  }, [mode]);

  /* ---- Switch to Fhenix ---- */
  const switchToFhenix = useCallback(async () => {
    // Burner is already on Sepolia by construction; no-op.
    if (mode === "burner") return;

    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) return;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: FHENIX_TESTNET.chainIdHex }],
      });
    } catch (switchError: unknown) {
      const err = switchError as { code?: number };
      if (err.code === 4902) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: FHENIX_TESTNET.chainIdHex,
                chainName: FHENIX_TESTNET.name,
                rpcUrls: [FHENIX_TESTNET.rpcUrl],
                blockExplorerUrls: [FHENIX_TESTNET.blockExplorer],
                nativeCurrency: FHENIX_TESTNET.nativeCurrency,
              },
            ],
          });
        } catch {
          setError("Failed to add Fhenix network to wallet.");
        }
      } else {
        setError("Failed to switch to Fhenix network.");
      }
    }
  }, [mode]);

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

/* ---------- Ethereum type augmentation ---------- */

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
