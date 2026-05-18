"use client";

export const dynamic = "force-dynamic";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#FAFAF7",
          color: "#111111",
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          padding: "0 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 480 }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#6B6B66",
              marginBottom: 24,
            }}
          >
            — Error
          </div>
          <h2
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.08,
              marginBottom: 16,
            }}
          >
            Something went{" "}
            <em
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 400,
              }}
            >
              wrong
            </em>
            .
          </h2>
          <p style={{ color: "#3D3D3A", marginBottom: 32, lineHeight: 1.6 }}>
            CipherDEX hit an unexpected error. The protocol is fine — try again or
            refresh the page.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "12px 24px",
              background: "#111111",
              color: "#FAFAF7",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
