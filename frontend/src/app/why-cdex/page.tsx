import Link from "next/link";
import { CONTRACTS, FHENIX_TESTNET, TOKEN_CONFIG } from "@/lib/constants";

/**
 * /why-cdex — what the two test tokens are. Linked from the footer and FAQ.
 */
export default function TestTokensPage() {
  const tokens = [
    {
      symbol: TOKEN_CONFIG.symbol,
      name: TOKEN_CONFIG.name,
      role: "What bidders pay with, and what payroll pays out. The header faucet and Quickstart hand it out.",
      address: CONTRACTS.ConfidentialToken,
    },
    {
      symbol: "MOCK",
      name: "Mock Project Token",
      role: "What the demo sales sell — a stand-in for a foundation's own token. Get it from the faucet on the Treasury page.",
      address: CONTRACTS.MockToken,
    },
  ];

  return (
    <div className="font-body max-w-[760px] mx-auto py-12 md:py-20 space-y-10" style={{ color: "var(--text)" }}>
      <header className="space-y-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
          — Test tokens
        </div>
        <h1
          className="font-display font-bold tracking-tight leading-[1.05]"
          style={{ fontSize: "clamp(32px, 4.4vw, 52px)", letterSpacing: "-0.03em" }}
        >
          CDEX and MOCK
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 17, lineHeight: 1.65 }}>
          Zerith runs on Ethereum Sepolia with two test tokens. Neither has any value. Both
          are ERC-7984 confidential tokens (Fhenix&apos;s FHERC20): balances are encrypted
          on-chain and only the holder can read their own. Each faucet gives 1,000 tokens,
          once per hour per wallet. The CDEX symbol comes from the project&apos;s earlier
          name.
        </p>
      </header>

      <div className="space-y-4">
        {tokens.map((t) => (
          <div
            key={t.symbol}
            className="p-5 space-y-2"
            style={{ background: "var(--bg-card)", border: "1px dashed var(--border-dash)", borderRadius: "var(--radius)" }}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="font-display text-xl font-semibold">{t.symbol}</h2>
              <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                {t.name} · 6 decimals
              </span>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.6 }}>{t.role}</p>
            <a
              href={`${FHENIX_TESTNET.blockExplorer}/address/${t.address}#code`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs underline underline-offset-2 break-all"
              style={{ color: "var(--text)" }}
            >
              {t.address}
            </a>
          </div>
        ))}
      </div>

      <p style={{ color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.6 }}>
        To use them, deposit into your encrypted vault on the{" "}
        <Link href="/treasury" className="underline" style={{ color: "var(--text)" }}>Treasury</Link>{" "}
        page, or follow the{" "}
        <Link href="/quickstart" className="underline" style={{ color: "var(--text)" }}>Quickstart</Link>.
      </p>
    </div>
  );
}
