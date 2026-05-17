"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ethers } from "ethers";
import { FHENIX_TESTNET } from "@/lib/constants";

/* ---------- Types ---------- */

interface WalletState {
  /** Currently connected account address (null if disconnected) */
  account: string | null;
  /** ethers BrowserProvider wrapping window.ethereum */
  provider: ethers.BrowserProvider | null;
  /** ethers JsonRpcSigner for the connected account */
  signer: ethers.JsonRpcSigner | null;
  /** Whether the wallet is on the correct chain */
  isCorrectChain: boolean;
  /** Whether a connection attempt is in progress */
  connecting: boolean;
  /** Last wallet error message */
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToFhenix: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/* ---------- Provider ---------- */

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [isCorrectChain, setIsCorrectChain] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- Check chain ---- */
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
          await checkChain(prov);
        }
      })
      .catch(() => {
        // Not connected — that is fine
      });

    // Listen for account / chain changes
    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        setSigner(null);
        setIsCorrectChain(false);
      } else {
        setAccount(accounts[0]);
        prov.getSigner().then(setSigner).catch(() => setSigner(null));
        // Audit fix E1: notify pages so they can clear cross-account state
        // (e.g. unsealed bid amounts, in-progress encryption, cached handles)
        window.dispatchEvent(new CustomEvent("sigil-account-changed", { detail: accounts[0] }));
      }
    };

    const handleChainChanged = (...args: unknown[]) => {
      // Audit fix E2: previously did window.location.reload() which nuked
      // every modal mid-form (auction creation with 20 recipients, etc.).
      // Now: re-init provider/signer in place so user keeps their state.
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
  }, [checkChain]);

  /* ---- Connect ---- */
  const connect = useCallback(async () => {
    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) {
      setError("MetaMask is not installed. Please install it to continue.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const prov = new ethers.BrowserProvider(ethereum);
      await prov.send("eth_requestAccounts", []);
      const s = await prov.getSigner();
      const addr = await s.getAddress();

      setProvider(prov);
      setSigner(s);
      setAccount(addr);
      await checkChain(prov);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
    } finally {
      setConnecting(false);
    }
  }, [checkChain]);

  /* ---- Disconnect ---- */
  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
    setProvider(null);
    setIsCorrectChain(false);
    setError(null);
  }, []);

  /* ---- Switch to Fhenix ---- */
  const switchToFhenix = useCallback(async () => {
    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!ethereum) return;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: FHENIX_TESTNET.chainIdHex }],
      });
    } catch (switchError: unknown) {
      // Chain not added — add it
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
  }, []);

  /* ---- Context value ---- */
  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      provider,
      signer,
      isCorrectChain,
      connecting,
      error,
      connect,
      disconnect,
      switchToFhenix,
    }),
    [account, provider, signer, isCorrectChain, connecting, error, connect, disconnect, switchToFhenix],
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
