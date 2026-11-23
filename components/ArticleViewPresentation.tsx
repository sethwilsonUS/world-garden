"use client";

import { splitArticleSummary } from "@/lib/article-summary";
import Image from "next/image";
import { type MouseEvent as ReactMouseEvent } from "react";
import type { Article } from "@/lib/data-context";
import { AdaptiveImageFrame } from "@/components/AdaptiveImageFrame";
import { GalleryLightbox, type LightboxState } from "./GalleryLightbox";
import { MediaAttribution } from "@/components/MediaAttribution";
import type { AdaptiveImageAnalysis } from "@/lib/adaptive-image";

type ArticleHeroProps = {
  article: Article;
  imageAnalysis: AdaptiveImageAnalysis | null;
  lightbox: LightboxState;
  onLightboxChange: (state: LightboxState) => void;
};

const summaryTextClassName =
  "m-0 max-w-[70ch] break-words text-[1.0625rem] leading-relaxed text-foreground-2 [overflow-wrap:anywhere]";

/**
 * The article summary on every breakpoint: the lead sentence at a comfortable
 * reading size, with the remainder behind one "Read full summary" disclosure
 * so listening controls and sections are never pushed screens away.
 */
export const ArticleSummary = ({ summary }: { summary?: string }) => {
  const { lead, remainder } = splitArticleSummary(summary ?? "");
  if (!lead) return null;
  const remainderParagraphs = remainder
    ? remainder
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="min-w-0" data-article-summary>
      <p className={summaryTextClassName} data-article-summary-lead>
        {lead}
      </p>
      {remainderParagraphs.length > 0 ? (
        <details className="group mt-2" data-article-summary-disclosure>
          <summary className="btn-tertiary -ml-3 cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={14}
              height={14}
              aria-hidden="true"
              focusable="false"
              className="shrink-0 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="group-open:hidden">Read full summary</span>
            <span className="hidden group-open:inline">Hide full summary</span>
          </summary>
          <div
            className="mt-2 flex flex-col gap-3"
            data-article-summary-remainder
          >
            {remainderParagraphs.map((paragraph, index) => (
              <p key={index} className={summaryTextClassName}>
                {paragraph}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
};

/**
 * Summary plus lead image. The image is capped in height and, on wide screens,
 * sits beside the summary instead of above it. Summary comes first in reading
 * order on every breakpoint.
 */
export const ArticleHero = ({
  article,
  imageAnalysis,
  lightbox,
  onLightboxChange,
}: ArticleHeroProps) => {
  const { summary, thumbnailAttribution, thumbnailUrl } = article;

  if (!thumbnailUrl) {
    return summary ? (
      <section aria-label="Article summary" className="mb-8">
        <ArticleSummary summary={summary} />
      </section>
    ) : null;
  }

  const width = article.thumbnailWidth ?? 0;
  const height = article.thumbnailHeight ?? 0;
  const hasDimensions = width > 0 && height > 0;
  const intrinsicWidth = hasDimensions ? width : 1200;
  const intrinsicHeight = hasDimensions ? height : 675;
  const isPortrait = width > 0 && height >= width;
  const hasTransparentHero =
    imageAnalysis?.url === thumbnailUrl && imageAnalysis.hasTransparency;
  const imagePanelStyle = hasTransparentHero
    ? {
        background:
          imageAnalysis?.panelBackground ??
          "linear-gradient(180deg, rgba(244, 241, 232, 0.98), rgba(214, 220, 212, 0.92))",
        borderColor:
          imageAnalysis?.panelBorderColor ?? "rgba(255, 255, 255, 0.14)",
      }
    : undefined;
  const openLightbox = (event: ReactMouseEvent<HTMLButtonElement>) => {
    onLightboxChange({ index: 0, opener: event.currentTarget });
  };

  return (
    <section
      aria-label="Article summary"
      className="mb-8 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start lg:gap-6"
    >
      {summary ? <ArticleSummary summary={summary} /> : <div />}

      <figure className="m-0 min-w-0">
        {isPortrait ? (
          <div className="relative overflow-hidden rounded-xl">
            <button
              type="button"
              onClick={openLightbox}
              aria-label={`View full image for ${article.title}`}
              className="absolute inset-0 z-20 cursor-zoom-in rounded-xl border-0 bg-transparent focus-visible:[box-shadow:inset_0_0_0_2px_white,inset_0_0_0_4px_rgba(0,0,0,0.9)]"
            />
            <Image
              src={thumbnailUrl}
              alt=""
              aria-hidden="true"
              fill
              sizes="(min-width: 1024px) 16rem, 100vw"
              className="object-cover"
              style={{
                transform: "scale(1.8)",
                filter: "blur(80px) brightness(0.65)",
              }}
              unoptimized
            />
            <div className="absolute inset-0 bg-black/45" />
            <div className="relative flex items-center justify-center p-4 sm:p-6">
              <div
                className={
                  hasTransparentHero
                    ? "shrink-0 rounded-[20px] border border-white/15 p-3 shadow-2xl"
                    : "shrink-0"
                }
                style={imagePanelStyle}
              >
                <Image
                  src={thumbnailUrl}
                  alt={article.title}
                  width={intrinsicWidth}
                  height={intrinsicHeight}
                  className="max-h-56 w-auto shrink-0 rounded-lg object-contain sm:max-h-72"
                  priority
                  unoptimized
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl">
            <AdaptiveImageFrame
              src={thumbnailUrl}
              alt={article.title}
              width={width}
              height={height}
              sizes="(min-width: 1024px) 16rem, 100vw"
              className="h-48 w-full sm:h-64 lg:h-44"
              priority
              unoptimized
            />
            <button
              type="button"
              onClick={openLightbox}
              aria-label={`View full image for ${article.title}`}
              className="absolute inset-0 z-20 cursor-zoom-in rounded-xl border-0 bg-transparent focus-visible:[box-shadow:inset_0_0_0_2px_white,inset_0_0_0_4px_rgba(0,0,0,0.9)]"
            />
          </div>
        )}

        {thumbnailAttribution ? (
          <figcaption className="mt-1 px-1">
            <MediaAttribution attribution={thumbnailAttribution} compact />
          </figcaption>
        ) : null}
      </figure>

      {lightbox && (
        <GalleryLightbox
          images={[
            {
              src: thumbnailUrl,
              originalSrc: thumbnailUrl,
              alt: article.title,
              caption: "",
              attribution: thumbnailAttribution,
            },
          ]}
          state={lightbox}
          onClose={() => onLightboxChange(null)}
        />
      )}
    </section>
  );
};

export const ArticleLoadingState = () => (
  <div role="status" aria-label="Fetching article from Wikipedia">
    <div className="garden-bed text-center px-6 py-8">
      <svg
        className="animate-spin mx-auto mb-4 text-accent"
        fill="none"
        viewBox="0 0 24 24"
        width="32"
        height="32"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <p className="font-display font-semibold text-foreground">
        Planting seeds...
      </p>
      <p className="text-muted text-sm mt-2">Fetching article from Wikipedia</p>
    </div>
  </div>
);

export const ArticleLoadError = ({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) => (
  <div className="alert-banner alert-error" role="alert">
    <WarningIcon />
    <div>
      <p className="font-semibold">Could not load article</p>
      <p className="text-sm mt-1">{error}</p>
      <button
        onClick={onRetry}
        className="btn-secondary mt-3 px-4 py-2 text-sm"
        aria-label="Try loading article again"
      >
        Try again
      </button>
    </div>
  </div>
);

export const ResumeBanner = ({
  sectionLabel,
  onResume,
  onStartOver,
}: {
  sectionLabel: string;
  onResume: () => void;
  onStartOver: () => void;
}) => (
  <div
    role="status"
    className="garden-bed py-4 px-5 mb-4 flex items-center flex-wrap gap-3"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
      className="text-accent shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
    <span className="flex-1 text-sm text-foreground-2">
      Resume from <strong>{sectionLabel}</strong>?
    </span>
    <div className="flex max-w-full flex-wrap gap-2">
      <button
        onClick={onResume}
        className="btn-primary min-h-[44px] max-w-full flex-wrap px-4 py-2 text-center text-sm"
      >
        Resume
      </button>
      <button
        onClick={onStartOver}
        className="btn-secondary min-h-[44px] max-w-full flex-wrap px-4 py-2 text-center text-sm"
      >
        Start over
      </button>
    </div>
  </div>
);

export const AudioErrorNotice = ({
  error,
  retryLabel,
  onRetry,
}: {
  error: string;
  retryLabel: string;
  onRetry: () => void;
}) => (
  <div className="garden-bed p-5 mb-6 animate-fade-in-up-delay-1">
    <div className="alert-banner alert-error" role="alert">
      <WarningIcon className="shrink-0 mt-0.5" />
      <div>
        <p className="text-sm">{error}</p>
        <button
          onClick={onRetry}
          className="btn-secondary mt-3 px-4 py-2 text-sm"
          aria-label={retryLabel}
        >
          Try again
        </button>
      </div>
    </div>
  </div>
);

const WarningIcon = ({ className = "shrink-0" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={20}
    height={20}
    aria-hidden="true"
    className={className}
  >
    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);
