"use client";

import Image from "next/image";
import { type MouseEvent as ReactMouseEvent } from "react";
import type { Article } from "@/lib/data-context";
import { AdaptiveImageFrame } from "@/components/AdaptiveImageFrame";
import { Lightbox, type LightboxState } from "./ArticleGallery";
import { MediaAttribution } from "@/components/MediaAttribution";
import type { AdaptiveImageAnalysis } from "@/lib/adaptive-image";

type ArticleHeroProps = {
  article: Article;
  imageAnalysis: AdaptiveImageAnalysis | null;
  lightbox: LightboxState;
  onLightboxChange: (state: LightboxState) => void;
};

export const ArticleHero = ({
  article,
  imageAnalysis,
  lightbox,
  onLightboxChange,
}: ArticleHeroProps) => {
  const { summary, thumbnailAttribution, thumbnailUrl } = article;

  if (!thumbnailUrl) {
    return summary ? (
      <div className="hidden min-[360px]:block mb-4">
        <p className="text-sm leading-relaxed text-muted line-clamp-3">{summary}</p>
      </div>
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
    <>
      {isPortrait ? (
        <div className="relative mb-4 overflow-hidden rounded-xl">
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
            sizes="100vw"
            className="object-cover"
            style={{ transform: "scale(1.8)", filter: "blur(80px) brightness(0.65)" }}
            unoptimized
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="relative flex items-center justify-center gap-16 p-6 sm:p-10">
            <div
              className={
                hasTransparentHero
                  ? "shrink-0 rounded-[1.25rem] border border-white/15 p-3 sm:p-4 shadow-2xl"
                  : "shrink-0"
              }
              style={imagePanelStyle}
            >
              <Image
                src={thumbnailUrl}
                alt={article.title}
                width={intrinsicWidth}
                height={intrinsicHeight}
                className="max-h-56 sm:max-h-72 w-auto object-contain rounded-lg shrink-0"
                priority
                unoptimized
              />
            </div>
            {summary && (
              <div className="relative z-20 hidden max-w-sm md:block">
                <p
                  className="text-sm leading-relaxed text-white line-clamp-[7]"
                  style={{ textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)" }}
                >
                  {summary}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="relative mb-4 overflow-hidden rounded-xl">
          <AdaptiveImageFrame
            src={thumbnailUrl}
            alt={article.title}
            width={width}
            height={height}
            sizes="100vw"
            className="h-48 w-full sm:h-64"
            backdropImageClassName={summary ? "md:pb-24" : undefined}
            priority
            unoptimized
          >
            {summary && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 hidden rounded-b-xl bg-black/70 px-5 py-4 md:block"
                style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
              >
                <p className="text-sm leading-relaxed text-white line-clamp-3">{summary}</p>
              </div>
            )}
          </AdaptiveImageFrame>
          <button
            type="button"
            onClick={openLightbox}
            aria-label={`View full image for ${article.title}`}
            className="absolute inset-0 z-20 cursor-zoom-in rounded-xl border-0 bg-transparent focus-visible:[box-shadow:inset_0_0_0_2px_white,inset_0_0_0_4px_rgba(0,0,0,0.9)]"
          />
        </div>
      )}

      {thumbnailAttribution ? (
        <div className="-mt-1 mb-4 px-1">
          <MediaAttribution attribution={thumbnailAttribution} compact />
        </div>
      ) : null}

      {summary && (
        <div className="hidden min-[360px]:block md:hidden mb-4">
          <p className="text-sm leading-relaxed text-muted line-clamp-3">{summary}</p>
        </div>
      )}

      {lightbox && (
        <Lightbox
          images={[{
            src: thumbnailUrl,
            originalSrc: thumbnailUrl,
            alt: article.title,
            caption: "",
            attribution: thumbnailAttribution,
          }]}
          state={lightbox}
          onClose={() => onLightboxChange(null)}
        />
      )}
    </>
  );
};

export const ArticleLoadingState = () => (
  <div role="status" aria-label="Fetching article from Wikipedia">
    <div className="garden-bed text-center px-6 py-8">
      <svg className="animate-spin mx-auto mb-4 text-accent" fill="none" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <p className="font-display font-semibold text-foreground">Planting seeds...</p>
      <p className="text-muted text-sm mt-2">Fetching article from Wikipedia</p>
    </div>
  </div>
);

export const ArticleLoadError = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <div className="alert-banner alert-error" role="alert">
    <WarningIcon />
    <div>
      <p className="font-semibold">Could not load article</p>
      <p className="text-sm mt-1">{error}</p>
      <button onClick={onRetry} className="btn-secondary mt-3 px-4 py-2 text-sm" aria-label="Try loading article again">
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
  <div role="status" className="garden-bed py-4 px-5 mb-4 flex items-center flex-wrap gap-3">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true" className="text-accent shrink-0">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
    <span className="flex-1 text-sm text-foreground-2">
      Resume from <strong>{sectionLabel}</strong>?
    </span>
    <div className="flex gap-2">
      <button onClick={onResume} className="btn-primary px-4 py-2 text-[0.8125rem]">Resume</button>
      <button onClick={onStartOver} className="btn-secondary px-4 py-2 text-[0.8125rem]">Start over</button>
    </div>
  </div>
);

export const AudioErrorNotice = ({ error, retryLabel, onRetry }: { error: string; retryLabel: string; onRetry: () => void }) => (
  <div className="garden-bed p-5 mb-6 animate-fade-in-up-delay-1">
    <div className="alert-banner alert-error" role="alert">
      <WarningIcon className="shrink-0 mt-0.5" />
      <div>
        <p className="text-sm">{error}</p>
        <button onClick={onRetry} className="btn-secondary mt-3 px-4 py-2 text-sm" aria-label={retryLabel}>Try again</button>
      </div>
    </div>
  </div>
);

const WarningIcon = ({ className = "shrink-0" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={20} height={20} aria-hidden="true" className={className}>
    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);
