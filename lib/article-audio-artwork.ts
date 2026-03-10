import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { loadOgFonts } from "@/app/og-fonts";

const ARTWORK_SIZE = 3000;
const PRIMARY = "#10261e";
const SECONDARY = "#1b4332";
const PANEL = "rgba(8, 23, 17, 0.84)";
const BORDER = "rgba(255, 255, 255, 0.14)";
const IMAGE_PANEL = "rgba(255, 255, 255, 0.05)";

export type ArticleAudioArtworkInput = {
  title: string;
  summary?: string | null;
  imageUrl?: string | null;
};

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

const fetchImageDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!contentType?.startsWith("image/")) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return null;

    return `data:${contentType};base64,${toBase64(bytes)}`;
  } catch {
    return null;
  }
};

const getInitials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const renderArticleAudioArtworkResponse = async ({
  title,
  summary,
  imageUrl,
}: ArticleAudioArtworkInput): Promise<ImageResponse> => {
  const fonts = await loadOgFonts();
  const imageDataUrl = imageUrl ? await fetchImageDataUrl(imageUrl) : null;
  const titleLabel = truncate(title.trim() || "Wikipedia article", 72);
  const summaryLabel = truncate((summary ?? "").trim(), 180);

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
          background:
            `radial-gradient(circle at top right, rgba(217, 249, 157, 0.16), transparent 36%), ` +
            `linear-gradient(180deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
          position: "relative",
          overflow: "hidden",
          padding: "150px",
        },
      },
      h("div", {
        style: {
          position: "absolute",
          inset: "54px",
          borderRadius: "110px",
          border: `10px solid ${BORDER}`,
        },
      }),
      h(
        "div",
        {
          style: {
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRadius: "96px",
            overflow: "hidden",
            background: PANEL,
            border: `8px solid ${BORDER}`,
            boxShadow: "0 50px 120px rgba(0, 0, 0, 0.28)",
            padding: "110px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "92px",
              lineHeight: 1.1,
              fontWeight: 700,
              color: "#f5fdf7",
              letterSpacing: "-0.03em",
            },
          },
          "Wikipedia article audio",
        ),
        h(
          "div",
          {
            style: {
              flex: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: "72px",
              marginBottom: "64px",
              padding: "36px",
              borderRadius: "54px",
              background: IMAGE_PANEL,
            },
          },
          h(
            "div",
            {
              style: {
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "42px",
                overflow: "hidden",
                background: "rgba(0, 0, 0, 0.22)",
                position: "relative",
              },
            },
            imageDataUrl
              ? h("img", {
                  src: imageDataUrl,
                  alt: titleLabel,
                  width: "100%",
                  height: "100%",
                  style: {
                    objectFit: "contain",
                    objectPosition: "center center",
                  },
                })
              : h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "100%",
                      height: "100%",
                      color: "rgba(255,255,255,0.92)",
                      fontFamily: "Fraunces, serif",
                      fontSize: "220px",
                      fontWeight: 700,
                      letterSpacing: "-0.05em",
                    },
                  },
                  getInitials(titleLabel),
                ),
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Fraunces, serif",
                fontSize: "98px",
                lineHeight: 1.08,
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.04em",
                maxWidth: "2200px",
              },
            },
            titleLabel,
          ),
          summaryLabel
            ? h(
                "div",
                {
                  style: {
                    marginTop: "24px",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "54px",
                    lineHeight: 1.3,
                    color: "rgba(255,255,255,0.8)",
                    maxWidth: "2200px",
                  },
                },
                summaryLabel,
              )
            : null,
          h(
            "div",
            {
              style: {
                marginTop: "28px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: "52px",
                lineHeight: 1.2,
                color: "rgba(255,255,255,0.76)",
                letterSpacing: "0.04em",
              },
            },
            "Curio Garden • Powered by Wikipedia",
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
