import { ImageResponse } from "next/og";
import { loadOgFonts } from "./og-fonts";

export const alt = "Curio Garden — Listen to Wikipedia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const fonts = await loadOgFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#036b4a",
          fontFamily: "Fraunces, sans-serif",
        }}
      >
        {/* Leaf logo */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 512 512"
          fill="none"
          width="120"
          height="120"
        >
          <g
            stroke="#fff"
            strokeWidth="24"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M256 80C172 136 144 196 144 248c0 56 56 96 112 112 56-16 112-56 112-112 0-52-28-112-112-168z" />
            <path d="M256 80v320" />
            <path d="M256 160l-48 48" />
            <path d="M256 160l48 48" />
            <path d="M256 240l-64 48" />
            <path d="M256 240l64 48" />
          </g>
        </svg>

        <div
          style={{
            fontSize: "72px",
            fontWeight: 700,
            color: "#ffffff",
            marginTop: "24px",
            lineHeight: 1.1,
          }}
        >
          Curio Garden
        </div>

        <div
          style={{
            fontSize: "32px",
            fontWeight: 400,
            color: "rgba(255, 255, 255, 0.8)",
            marginTop: "12px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Listen to Wikipedia
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
