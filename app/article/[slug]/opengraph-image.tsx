import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/app/og-fonts";
import { fetchWikiSummary, truncateText } from "@/lib/wiki-summary";

export const alt = "Article preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function LeafIcon({ size: s }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      width={s}
      height={s}
    >
      <g
        stroke="#34d399"
        strokeWidth="28"
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
  );
}

function FallbackCard({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px",
        backgroundColor: "#171717",
        fontFamily: "DM Sans, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <LeafIcon size={36} />
        <span
          style={{
            fontSize: "24px",
            fontWeight: 700,
            color: "#34d399",
            fontFamily: "Fraunces, sans-serif",
          }}
        >
          Curio Garden
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            fontSize: "52px",
            fontWeight: 700,
            color: "#f0ede6",
            lineHeight: 1.15,
            fontFamily: "Fraunces, sans-serif",
          }}
        >
          {truncateText(title, 80)}
        </div>
        {summary && (
          <div
            style={{
              fontSize: "24px",
              color: "#a8b89e",
              lineHeight: 1.4,
            }}
          >
            {truncateText(summary, 180)}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          fontSize: "18px",
          color: "#516247",
        }}
      >
        Powered by Wikipedia
      </div>
    </div>
  );
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const fonts = await loadOgFonts();
  let title = decodeURIComponent(slug).replace(/_/g, " ");
  let summary = "";
  let thumbnailUrl: string | undefined;

  try {
    const article = await fetchWikiSummary(slug);
    if (article) {
      title = article.title;
      summary = article.extract;
      thumbnailUrl = article.thumbnailUrl;
    }
  } catch {
    // Render with slug-derived title if Wikipedia is unreachable
  }

  if (!thumbnailUrl) {
    return new ImageResponse(<FallbackCard title={title} summary={summary} />, {
      ...size,
      fonts,
    });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px",
          backgroundColor: "#171717",
          fontFamily: "DM Sans, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <LeafIcon size={36} />
          <span
            style={{
              fontSize: "24px",
              fontWeight: 700,
              color: "#34d399",
              fontFamily: "Fraunces, sans-serif",
            }}
          >
            Curio Garden
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "40px",
            flex: 1,
            alignItems: "center",
            marginTop: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: "48px",
                fontWeight: 700,
                color: "#f0ede6",
                lineHeight: 1.15,
                fontFamily: "Fraunces, sans-serif",
              }}
            >
              {truncateText(title, 70)}
            </div>
            {summary && (
              <div
                style={{
                  fontSize: "22px",
                  color: "#a8b89e",
                  lineHeight: 1.4,
                }}
              >
                {truncateText(summary, 160)}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "320px",
              height: "320px",
              borderRadius: "16px",
              border: "3px solid #34d399",
              backgroundColor: "#1a1a1a",
              overflow: "hidden",
              flexShrink: 0,
              padding: "12px",
            }}
          >
            <img
              src={thumbnailUrl}
              alt={title}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                borderRadius: "8px",
                objectFit: "contain",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            fontSize: "18px",
            color: "#516247",
          }}
        >
          Powered by Wikipedia
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
