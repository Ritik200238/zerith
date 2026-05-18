"use client";

import { Construction, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * ComingSoonBanner — honest signal that a page is wired but not yet end-to-end.
 *
 * Used on pages where the smart contract is deployed but the UI is not yet
 * fully integrated. Removes the lie of pretending these pages work and
 * redirects users to the working hero flows.
 *
 * Per the Sigil integrity rule: never fake functionality, always be honest
 * about limitations.
 */

interface Props {
  feature: string;
  contractAddress?: string;
  /** Where to send users in the meantime */
  redirectHref?: string;
  redirectLabel?: string;
  shipDate?: string;
}

export function ComingSoonBanner({
  feature,
  contractAddress,
  redirectHref = "/auctions",
  redirectLabel = "Try Sealed Auctions",
  shipDate = "Wave 4 (May 11–20)",
}: Props) {
  return (
    <section
      className="rounded-xl border-2 border-dashed border-borderDash
                 bg-bgAlt/[0.04] p-6 md:p-8 space-y-4"
      role="status"
      aria-label={`${feature} not yet end-to-end`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bgAlt border border-borderDash flex items-center justify-center shrink-0">
          <Construction size={18} className="text-warning" />
        </div>
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-warning">
            {feature} — Coming in {shipDate}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            The smart contract for this feature is deployed and tested. The UI
            is being built right now and will go live in Wave 4. We chose to
            show this honest state instead of hiding the page or shipping a
            non-functional form.
          </p>
          {contractAddress && (
            <p className="text-[11px] text-[var(--text-muted)] font-mono">
              Contract:{" "}
              <a
                href={`https://sepolia.etherscan.io/address/${contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-warning/80 hover:text-warning underline-offset-2 hover:underline"
              >
                {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)} ↗
              </a>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-borderDash">
        <p className="text-xs text-[var(--text-muted)]">
          Want to try CipherDEX now?
        </p>
        <Link
          href={redirectHref}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md
                     bg-bgAlt border border-borderDash
                     text-success text-xs font-medium
                     hover:bg-bgAlt transition-all"
        >
          {redirectLabel}
          <ArrowRight size={11} />
        </Link>
      </div>
    </section>
  );
}
