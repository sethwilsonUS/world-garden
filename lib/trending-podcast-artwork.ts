import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { loadOgFonts } from "@/app/og-fonts";

const ARTWORK_SIZE = 3000;
const ARTWORK_TILES = 4;
const PRIMARY = "#10261e";
const SECONDARY = "#1b4332";
const PANEL = "rgba(8, 23, 17, 0.82)";
const BORDER = "rgba(255, 255, 255, 0.14)";
const PLACEHOLDER_COLORS = [
  ["#0f766e", "#115e59"],
  ["#1d4ed8", "#1e3a8a"],
  ["#7c3aed", "#581c87"],
  ["#be123c", "#881337"],
];

type ArtworkTile = {
  title: string;
  imageUrl?: string | null;
};

export type TrendingArtworkInput = {
  trendingDate: string;
  headline?: string | null;
  articleTitles?: string[];
  imageUrls?: string[];
};

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const getInitials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

export const formatTrendingArtworkDate = (dateIso: string): string =>
  new Date(`${dateIso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const selectTrendingArtworkTiles = (
  articleTitles?: string[],
  imageUrls?: string[],
): ArtworkTile[] => {
  const titles = articleTitles ?? [];
  const urls = imageUrls ?? [];
  const tiles: ArtworkTile[] = [];

  for (let index = 0; index < ARTWORK_TILES; index += 1) {
    const title = titles[index]?.trim();
    const imageUrl = urls[index]?.trim();

    if (!title && !imageUrl) continue;
    tiles.push({
      title: title || `Trending topic ${index + 1}`,
      imageUrl: imageUrl || undefined,
    });
  }

  return tiles;
};

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

const buildTileData = async (tiles: ArtworkTile[]) =>
  await Promise.all(
    tiles.map(async (tile) => ({
      title: tile.title,
      imageDataUrl: tile.imageUrl ? await fetchImageDataUrl(tile.imageUrl) : null,
    })),
  );

export const renderTrendingPodcastArtworkResponse = async ({
  trendingDate,
  articleTitles,
  imageUrls,
}: TrendingArtworkInput): Promise<ImageResponse> => {
  const fonts = await loadOgFonts();
  const tiles = await buildTileData(selectTrendingArtworkTiles(articleTitles, imageUrls));
  const headerLabel = truncate(
    `Trending on Wikipedia ${formatTrendingArtworkDate(trendingDate)}`,
    40,
  );

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
          background: `radial-gradient(circle at top right, rgba(217, 249, 157, 0.16), transparent 36%), linear-gradient(180deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
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
          headerLabel,
        ),
        h(
          "div",
          {
            style: {
              width: "100%",
              flex: "1",
              display: "flex",
              flexWrap: "wrap",
              alignContent: "space-between",
              justifyContent: "space-between",
              marginTop: "72px",
              marginBottom: "62px",
              padding: "12px",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: "54px",
            },
          },
          ...Array.from({ length: ARTWORK_TILES }).map((_, index) => {
            const tile = tiles[index];
            const fallback = PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length];

            return h(
              "div",
              {
                key: `${tile?.title ?? "placeholder"}-${index}`,
                style: {
                  position: "relative",
                  display: "flex",
                  width: "49.4%",
                  height: "49.4%",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  overflow: "hidden",
                  borderRadius: "42px",
                  background: `linear-gradient(180deg, ${fallback[0]} 0%, ${fallback[1]} 100%)`,
                },
              },
              tile?.imageDataUrl
                ? h("img", {
                    src: tile.imageDataUrl,
                    alt: tile.title,
                    width: "100%",
                    height: "100%",
                    style: {
                      position: "absolute",
                      inset: 0,
                      objectFit: "cover",
                    },
                  })
                : h(
                    "div",
                    {
                      style: {
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "rgba(255,255,255,0.92)",
                        fontFamily: "Fraunces, serif",
                        fontSize: "148px",
                        fontWeight: 700,
                        letterSpacing: "-0.04em",
                      },
                    },
                    getInitials(tile?.title ?? `Trending ${index + 1}`),
                  ),
              h("div", {
                style: {
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.02) 12%, rgba(0,0,0,0.52) 100%)",
                },
              }),
              h(
                "div",
                {
                  style: {
                    position: "relative",
                    display: "flex",
                    padding: "28px 30px",
                    color: "#ffffff",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "52px",
                    lineHeight: 1.18,
                    fontWeight: 700,
                  },
                },
                truncate(tile?.title ?? `Trending topic ${index + 1}`, 32),
              ),
            );
          }),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "54px",
              lineHeight: 1.2,
              color: "rgba(255,255,255,0.76)",
              letterSpacing: "0.04em",
            },
          },
          "Powered by Curio Garden",
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

export const renderTrendingPodcastArtworkPng = async (
  input: TrendingArtworkInput,
): Promise<{ data: Uint8Array; mimeType: string }> => {
  const response = await renderTrendingPodcastArtworkResponse(input);
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: "image/png",
  };
};
