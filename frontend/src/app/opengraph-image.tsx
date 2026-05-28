import { ImageResponse } from "next/og";

/**
 * Open Graph + Twitter card image — 1200x630.
 *
 * Editorial design language:
 *   - Warm off-white background (#FAFAF7)
 *   - Dark Z block + italic-serif "ith" wordmark
 *   - Tagline in display weight
 *   - Mono kicker label with em-dash prefix
 *   - Dashed border
 *
 * Renders via Next.js's @vercel/og runtime, so no static PNG is committed.
 * Cache-busts automatically when this file changes.
 */

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt =
  "Zerith — Encrypted block sales for token foundations on Fhenix FHE";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#FAFAF7",
          color: "#111111",
          padding: 80,
          position: "relative",
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}
      >
        {/* Dashed inner frame — editorial signature */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: "2px dashed #C8C4B8",
            borderRadius: 6,
            pointerEvents: "none",
          }}
        />

        {/* Kicker */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#6B6B66",
            marginBottom: 60,
          }}
        >
          — Encrypted block sales for token foundations
        </div>

        {/* Wordmark + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
          }}
        >
          {/* Wordmark row: Z block + Zerith text */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginBottom: 36,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 96,
                height: 96,
                background: "#111111",
                borderRadius: 8,
                color: "#FAFAF7",
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                fontSize: 72,
                lineHeight: 1,
              }}
            >
              Z
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                fontSize: 96,
                fontWeight: 700,
                letterSpacing: -3,
                lineHeight: 1,
              }}
            >
              <span>Zer</span>
              <span
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 400,
                }}
              >
                ith
              </span>
            </div>
          </div>

          {/* Tagline */}
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.1,
              maxWidth: 980,
            }}
          >
            <span>Sell your&nbsp;</span>
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 400,
              }}
            >
              treasury
            </span>
            <span>&nbsp;without leaking it.</span>
          </div>
        </div>

        {/* Footer row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 18,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#6B6B66",
            paddingTop: 40,
            borderTop: "1px dashed #C8C4B8",
          }}
        >
          <span>Built on Fhenix CoFHE</span>
          <span>zerith-fi.vercel.app</span>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
