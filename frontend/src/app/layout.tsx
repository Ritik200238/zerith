import type { Metadata } from "next";
import { Providers } from "@/components/layout/Providers";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

// Fonts loaded via <link> instead of next/font/google because this project
// builds with `next build --webpack` (per package.json), and next/font/google
// requires the SWC/Turbopack font loader. The CSS variables --font-display etc.
// are defined in globals.css and consumed by Tailwind config.

export const metadata: Metadata = {
  title: "Zerith — Private Finance Infrastructure",
  description:
    "Launch tokens, pay contributors, trade privately, hire talent. Every bid, payment, and trade encrypted on-chain with fully homomorphic encryption on Fhenix.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
