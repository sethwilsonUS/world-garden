import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { loadOgFonts } from "@/app/og-fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ARTWORK_SIZE = 3000;
const PRIMARY = "#10261e";
const SECONDARY = "#1b4332";
const ACCENT = "#d9f99d";
const GLOW = "rgba(217, 249, 157, 0.14)";
const PANEL = "rgba(9, 26, 20, 0.9)";

export const GET = async () => {
  const fonts = await loadOgFonts();

  const response = new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `radial-gradient(circle at top right, ${GLOW}, transparent 36%), linear-gradient(180deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
          position: "relative",
          overflow: "hidden",
        },
      },
      h("div", {
        style: {
          position: "absolute",
          inset: "7%",
          borderRadius: "11%",
          border: "14px solid rgba(255, 255, 255, 0.12)",
        },
      }),
      h("div", {
        style: {
          position: "absolute",
          width: "46%",
          height: "46%",
          borderRadius: "50%",
          top: "-6%",
          right: "-8%",
          background: "rgba(255, 255, 255, 0.05)",
        },
      }),
      h("div", {
        style: {
          position: "absolute",
          width: "40%",
          height: "40%",
          borderRadius: "50%",
          bottom: "-10%",
          left: "-7%",
          background: "rgba(217, 249, 157, 0.08)",
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
            textAlign: "center",
            padding: "210px",
            gap: "68px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "1380px",
              padding: "86px 88px",
              borderRadius: "84px",
              background: PANEL,
              border: "8px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 42px 120px rgba(0, 0, 0, 0.24)",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "DM Sans, sans-serif",
                fontSize: "60px",
                lineHeight: 1.1,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "rgba(255, 255, 255, 0.72)",
              },
            },
            "Presented by Curio Garden",
          ),
          h(
            "div",
            {
              style: {
                marginTop: "34px",
                fontFamily: "Fraunces, serif",
                fontSize: "236px",
                lineHeight: 0.92,
                fontWeight: 700,
                letterSpacing: "-0.05em",
                color: "#ffffff",
              },
            },
            "Trending Brief",
          ),
          h(
            "div",
            {
              style: {
                marginTop: "38px",
                maxWidth: "1040px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: "88px",
                lineHeight: 1.14,
                color: "rgba(255, 255, 255, 0.9)",
              },
            },
            "A daily audio briefing on what is trending across Wikipedia and why",
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "28px",
              padding: "26px 44px",
              borderRadius: "999px",
              background: "rgba(255, 255, 255, 0.08)",
              border: `6px solid ${ACCENT}`,
              color: "#ffffff",
            },
          },
          h(
            "div",
            {
              style: {
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                background: ACCENT,
                boxShadow: "0 0 0 18px rgba(217, 249, 157, 0.16)",
              },
            },
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "DM Sans, sans-serif",
                fontSize: "56px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              },
            },
            "Wikipedia Podcast",
          ),
        ),
      ),
    ),
    {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      fonts,
    },
  );

  response.headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
  return response;
};
