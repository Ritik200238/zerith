"use client";

import { useMemo } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/providers/WalletProvider";
import { getContract, getReadContract } from "@/lib/contracts";
import { CONTRACTS, FHENIX_TESTNET, type ContractName } from "@/lib/constants";

/**
 * Shared module-scoped read-only provider for public on-chain data.
 * Used as a fallback when no wallet is connected, so read-only views
 * (balances, auction state, etc.) work pre-connect without a wallet wall.
 * Lazily created once and reused across all useReadContract callers.
 */
let sharedReadProvider: ethers.JsonRpcProvider | null = null;

function getSharedReadProvider(): ethers.JsonRpcProvider {
  if (!sharedReadProvider) {
    sharedReadProvider = new ethers.JsonRpcProvider(
      FHENIX_TESTNET.rpcUrl,
      FHENIX_TESTNET.chainId,
    );
  }
  return sharedReadProvider;
}

/**
 * Returns an ethers.Contract instance connected to the wallet signer (for write ops).
 * Returns null if the wallet is not connected or the contract is not deployed.
 */
export function useContract(name: ContractName): ethers.Contract | null {
  const { signer } = useWallet();

  return useMemo(() => {
    if (!signer) return null;
    if (CONTRACTS[name] === "0x0000000000000000000000000000000000000000") return null;

    try {
      return getContract(name, signer);
    } catch {
      return null;
    }
  }, [name, signer]);
}

/**
 * Returns a read-only ethers.Contract instance for public on-chain data.
 * Uses the connected wallet's provider when available; otherwise falls back
 * to a shared module-scoped JsonRpcProvider so read-only views work
 * pre-connect (no wallet wall on public data).
 * Returns null only if the contract is not deployed.
 */
export function useReadContract(name: ContractName): ethers.Contract | null {
  const { provider } = useWallet();

  return useMemo(() => {
    if (CONTRACTS[name] === "0x0000000000000000000000000000000000000000") return null;

    const readProvider = provider ?? getSharedReadProvider();

    try {
      return getReadContract(name, readProvider);
    } catch {
      return null;
    }
  }, [name, provider]);
}
