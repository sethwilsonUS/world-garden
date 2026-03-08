import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { loadOgFonts } from "@/app/og-fonts";

export const runtime = "nodejs";

const ARTWORK_SIZE = 3000;
const PRIMARY = "#036b4a";
const SECONDARY = "#0f5132";
const ACCENT = "#d9f99d";

export const GET = async () => {
  const fonts = await loadOgFonts();

  return new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(180deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
          position: "relative",
          overflow: "hidden",
        },
      },
      h("div", {
        style: {
          position: "absolute",
          inset: "8%",
          borderRadius: "12%",
          border: "14px solid rgba(255, 255, 255, 0.12)",
        },
      }),
      h("div", {
        style: {
          position: "absolute",
          width: "58%",
          height: "58%",
          borderRadius: "50%",
          background: "rgba(217, 249, 157, 0.08)",
          top: "-8%",
          right: "-10%",
        },
      }),
      h("div", {
        style: {
          position: "absolute",
          width: "52%",
          height: "52%",
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.06)",
          bottom: "-14%",
          left: "-10%",
        },
      }),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "220px",
            textAlign: "center",
          },
        },
        h(
          "div",
          {
            style: {
              width: "520px",
              height: "520px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255, 255, 255, 0.1)",
              border: "18px solid rgba(255, 255, 255, 0.18)",
            },
          },
          h(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              viewBox: "0 0 512 512",
              fill: "none",
              width: "290",
              height: "290",
            },
            h(
              "g",
              {
                stroke: "#ffffff",
                strokeWidth: "24",
                strokeLinecap: "round",
                strokeLinejoin: "round",
              },
              h("path", {
                d: "M256 80C172 136 144 196 144 248c0 56 56 96 112 112 56-16 112-56 112-112 0-52-28-112-112-168z",
              }),
              h("path", { d: "M256 80v320" }),
              h("path", { d: "M256 160l-48 48" }),
              h("path", { d: "M256 160l48 48" }),
              h("path", { d: "M256 240l-64 48" }),
              h("path", { d: "M256 240l64 48" }),
            ),
          ),
        ),
        h(
          "div",
          {
            style: {
              marginTop: "140px",
              fontFamily: "Fraunces, serif",
              fontSize: "250px",
              lineHeight: 1,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: "-0.04em",
            },
          },
          "Curio Garden",
        ),
        h(
          "div",
          {
            style: {
              marginTop: "54px",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "94px",
              lineHeight: 1.2,
              color: "rgba(255, 255, 255, 0.9)",
              maxWidth: "1800px",
            },
          },
          "Wikipedia featured articles as a daily podcast",
        ),
        h(
          "div",
          {
            style: {
              marginTop: "80px",
              padding: "22px 42px",
              borderRadius: "999px",
              background: "rgba(255, 255, 255, 0.12)",
              border: `6px solid ${ACCENT}`,
              fontFamily: "DM Sans, sans-serif",
              fontSize: "58px",
              color: "#ffffff",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            },
          },
          "Featured Article Podcast",
        ),
      ),
    ),
    {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      fonts,
    },
  );
};
