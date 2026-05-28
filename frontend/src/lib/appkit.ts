/**
 * Reown AppKit (WalletConnect) init. Side-effect module: importing it once
 * anywhere in the client tree triggers createAppKit(), which globally
 * registers the wallet modal and the useAppKit + useDisconnect hooks.
 *
 * Why AppKit instead of raw wagmi: this app is built on ethers v6 + cofhejs
 * (Ethers6Adapter). Reown's ethers adapter returns an EIP-1193 walletProvider
 * we wrap with new ethers.BrowserProvider(...) — every existing contract
 * call site keeps working unchanged. A wagmi migration would force a rewrite
 * of every write call and re-bridging of cofhejs.
 *
 * The Sepolia network from @reown/appkit/networks targets the same chainId
 * (11155111) used by FHENIX_TESTNET in @/lib/constants — the brand says
 * "Fhenix" but the actual deployment is on Ethereum Sepolia where the Fhenix
 * CoFHE coprocessor lives.
 */

"use client";

import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { sepolia } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

if (!projectId && typeof window !== "undefined") {
  // Surfacing this loudly because without a Project ID the WalletConnect (QR
  // code → mobile wallet) path is disabled. Injected wallets like MetaMask
  // still work via EIP-6963 discovery, but the multi-wallet promise is broken.
  // eslint-disable-next-line no-console
  console.warn(
    "[Zerith] NEXT_PUBLIC_REOWN_PROJECT_ID is not set. The wallet modal will " +
      "still discover injected wallets (MetaMask etc.) but mobile-wallet QR " +
      "via WalletConnect is disabled. Grab a free Project ID at " +
      "https://cloud.reown.com and set it in .env.local.",
  );
}

const metadata = {
  name: "Zerith",
  description: "Private finance infrastructure for DAOs — encrypted block sales, payments, and treasury operations on Fhenix FHE.",
  url: "https://zerith-fi.vercel.app",
  icons: ["https://zerith-fi.vercel.app/favicon.svg"],
};

export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [sepolia],
  defaultNetwork: sepolia,
  metadata,
  projectId,
  features: {
    // Analytics off — this is a privacy product, don't ship behavioural
    // telemetry to Reown's backend by default.
    analytics: false,
    // Hide email/social login surface — foundations and DeFi users authenticate
    // with crypto wallets, not Google. Less noise in the modal.
    email: false,
    socials: false,
  },
  themeMode: "light",
  themeVariables: {
    "--w3m-accent": "#1f1f1f",
    "--w3m-border-radius-master": "2px",
    "--w3m-font-family":
      "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
});
