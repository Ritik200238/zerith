import { ImageResponse } from "next/og";

/**
 * Favicon — 32x32 PNG.
 *
 * Safari iOS does not render SVG favicons reliably. Next.js auto-detects
 * this file and serves it at /icon, with the metadata.icons block in
 * layout.tsx wiring it into the <link rel="icon"> chain.
 */

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 32, height: 32 };

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
          borderRadius: 4,
          color: "#FAFAF7",
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontStyle: "italic",
          fontSize: 22,
          fontWeight: 400,
          lineHeight: 1,
        }}
      >
        Z
      </div>
    ),
    {
      ...size,
    },
  );
}
