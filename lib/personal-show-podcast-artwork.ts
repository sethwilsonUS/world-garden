import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { loadOgFonts } from "@/app/og-fonts";

const ARTWORK_SIZE = 3000;
const PRIMARY = "#16332a";
const SECONDARY = "#1f4c3d";
const ACCENT = "#f4d35e";
const PANEL = "rgba(8, 24, 19, 0.84)";

export const renderPersonalShowPodcastArtworkResponse = async (): Promise<ImageResponse> => {
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
          background: `radial-gradient(circle at top left, rgba(244, 211, 94, 0.16), transparent 32%), linear-gradient(180deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
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
          width: "40%",
          height: "40%",
          borderRadius: "50%",
          top: "-9%",
          right: "-6%",
          background: "rgba(255, 255, 255, 0.06)",
        },
      }),
      h("div", {
        style: {
          position: "absolute",
          width: "46%",
          height: "46%",
          borderRadius: "50%",
          bottom: "-13%",
          left: "-10%",
          background: "rgba(244, 211, 94, 0.08)",
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
            padding: "220px",
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
              width: "1440px",
              padding: "96px 100px",
              borderRadius: "88px",
              background: PANEL,
              border: "8px solid rgba(255, 255, 255, 0.08)",
              boxShadow: "0 40px 120px rgba(0, 0, 0, 0.24)",
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
                color: "rgba(255, 255, 255, 0.7)",
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
                fontSize: "226px",
                lineHeight: 0.94,
                fontWeight: 700,
                letterSpacing: "-0.05em",
                color: "#ffffff",
              },
            },
            "Personal Playlist",
          ),
          h(
            "div",
            {
              style: {
                marginTop: "40px",
                maxWidth: "1080px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: "84px",
                lineHeight: 1.16,
                color: "rgba(255, 255, 255, 0.92)",
              },
            },
            "Your queued Wikipedia listens, delivered as a private RSS feed",
          ),
        ),
        h(
          "div",
          {
            style: {
              marginTop: "84px",
              display: "flex",
              alignItems: "center",
              gap: "26px",
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
                width: "54px",
                height: "54px",
                borderRadius: "18px",
                border: "6px solid rgba(255, 255, 255, 0.78)",
                boxSizing: "border-box",
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
            "Podcast Queue",
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
};

export const renderPersonalShowPodcastArtworkPng = async (): Promise<{
  data: Uint8Array;
  mimeType: string;
}> => {
  const response = await renderPersonalShowPodcastArtworkResponse();
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: "image/png",
  };
};
