import { ImageResponse } from "next/og";

/**
 * Apple touch icon — 180x180 PNG.
 *
 * Used when a user adds Zerith to their iOS home screen, and as the
 * fallback favicon for older Safari versions. Slightly larger Z block
 * than the 32x32 favicon to look correct at home-screen size.
 */

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 180, height: 180 };

export default async function AppleIcon() {
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
          color: "#FAFAF7",
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontStyle: "italic",
          fontSize: 124,
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
