"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useId, useRef } from "react";
import { useData } from "@/lib/data-context";
import type { ArticleImage } from "@/lib/data-context";
import { AdaptiveImageFrame } from "./AdaptiveImageFrame";
import { MediaAttribution } from "./MediaAttribution";

export type LightboxState = {
  index: number;
  opener?: HTMLElement | null;
} | null;

const navigationKeyIgnoredTags = new Set([
  "AUDIO",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "VIDEO",
]);

const shouldIgnoreGalleryNavigation = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return (
    navigationKeyIgnoredTags.has(target.tagName) ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    Boolean(
      target.closest(
        '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
      ),
    )
  );
};

const normalizeAlternativeText = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const getLightboxImageAlt = (image: ArticleImage): string => {
  const alt = image.alt?.trim() ?? "";
  const caption = image.caption?.trim() ?? "";

  if (
    !alt ||
    (caption &&
      normalizeAlternativeText(alt) === normalizeAlternativeText(caption))
  ) {
    return "";
  }

  return alt;
};

const ImageCard = ({
  image,
  index,
  total,
  onOpen,
}: {
  image: ArticleImage;
  index: number;
  total: number;
  onOpen: (index: number, opener: HTMLButtonElement) => void;
}) => {
  const [error, setError] = useState(false);
  const description = image.caption || image.alt || "Image";

  return (
    <li>
      <div className="garden-bed overflow-hidden">
        <button
          type="button"
          onClick={(event) => onOpen(index, event.currentTarget)}
          aria-label={`Open image ${index + 1} of ${total}: ${description}`}
          aria-haspopup="dialog"
          className="group block w-full cursor-zoom-in border-0 bg-transparent text-left transition-all duration-200 hover:bg-surface-3 focus-visible:[box-shadow:inset_0_0_0_2px_white,inset_0_0_0_4px_rgba(0,0,0,0.9)]"
        >
          {!error ? (
            <AdaptiveImageFrame
              src={image.src}
              alt=""
              width={image.width}
              height={image.height}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="aspect-[16/9] w-full"
              onError={() => setError(true)}
              unoptimized
            >
              {image.videoSrc && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60">
                    <svg viewBox="0 0 24 24" fill="white" width={22} height={22} aria-hidden="true">
                      <polygon points="8,5 20,12 8,19" />
                    </svg>
                  </div>
                </div>
              )}
            </AdaptiveImageFrame>
          ) : (
            <div
              role="img"
              aria-label="Image failed to load"
              className="flex aspect-[16/9] w-full items-center justify-center bg-surface-3"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeLinecap="round"
                strokeLinejoin="round"
                width={32}
                height={32}
                aria-hidden="true"
                className="text-muted opacity-30"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          )}
          {image.caption && (
            <span className="block px-4 py-3 text-[0.8125rem] leading-[1.5] text-muted line-clamp-3">
              {image.caption}
            </span>
          )}
        </button>
        {image.attribution ? (
          <div className="border-t border-border px-4 py-2.5">
            <MediaAttribution attribution={image.attribution} compact />
          </div>
        ) : null}
      </div>
    </li>
  );
};

export const Lightbox = ({
  images,
  state,
  onClose,
}: {
  images: ArticleImage[];
  state: LightboxState;
  onClose: () => void;
}) => {
  const [current, setCurrent] = useState(state?.index ?? 0);
  const [failedSources, setFailedSources] = useState<Set<string>>(
    () => new Set(),
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    openerRef.current =
      state?.opener ?? (document.activeElement as HTMLElement | null);
    const previousBodyOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (dialog.open) dialog.close();
      openerRef.current?.focus();
    };
  }, [state?.opener]);

  const showPrevious = useCallback(() => {
    setCurrent((value) => (value > 0 ? value - 1 : images.length - 1));
  }, [images.length]);

  const showNext = useCallback(() => {
    setCurrent((value) => (value < images.length - 1 ? value + 1 : 0));
  }, [images.length]);

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (
        images.length <= 1 ||
        shouldIgnoreGalleryNavigation(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showNext();
      }
    },
    [images.length, showNext, showPrevious],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (shouldIgnoreGalleryNavigation(e.target)) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || images.length <= 1) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) {
      showNext();
    } else {
      showPrevious();
    }
  }, [images.length, showNext, showPrevious]);

  if (!state) return null;

  const image = images[current];
  if (!image) return null;

  const preferredSource = image.lightboxSrc ?? image.src;
  const preferredSourceFailed =
    preferredSource !== image.src && failedSources.has(preferredSource);
  const displayedSource = preferredSourceFailed ? image.src : preferredSource;
  const displayedSourceFailed = failedSources.has(displayedSource);
  const imageStatus =
    preferredSourceFailed && !displayedSourceFailed
      ? "The larger image was unavailable, so the gallery thumbnail is shown."
      : null;
  const hasDetails = Boolean(
    imageStatus || image.caption || image.attribution,
  );
  const slideDescription = image.caption || image.alt || "Image";
  const imageAlternative = getLightboxImageAlt(image);

  const handleImageError = () => {
    setFailedSources((sources) => {
      const next = new Set(sources);
      next.add(displayedSource);
      return next;
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden border-none bg-transparent p-0 outline-none backdrop:bg-black/80"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby={titleId}
    >
      <div
        className="flex h-full w-full items-center justify-center bg-black/85"
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="grid h-full min-h-0 w-[calc(100%_-_1rem)] max-w-[100rem] grid-rows-[auto_minmax(0,1fr)_auto] sm:w-[calc(100%_-_2rem)]"
        >
          <header className="flex min-h-14 items-center gap-3 px-3 py-1 pt-[max(0.25rem,env(safe-area-inset-top))] sm:px-5">
            <h2 id={titleId} className="sr-only">
              Image gallery
            </h2>
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {`${slideDescription}, image ${current + 1} of ${images.length}`}
            </p>
            {images.length > 1 ? (
              <span
                className="font-mono text-xs text-white/60"
                aria-hidden="true"
              >
                {current + 1} / {images.length}
              </span>
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="ml-auto inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              aria-label="Close lightbox"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={24} height={24} aria-hidden="true">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div
            className="relative mx-2 min-h-0 overflow-hidden rounded-lg sm:mx-14"
            data-lightbox-media-stage=""
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={showPrevious}
                  className="absolute left-1 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:left-3"
                  aria-label="Previous image"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={28} height={28} aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={showNext}
                  className="absolute right-1 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:right-3"
                  aria-label="Next image"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={28} height={28} aria-hidden="true">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </>
            )}

            {image.videoSrc ? (
              <video
                src={image.videoSrc}
                poster={image.src}
                controls
                preload="metadata"
                className="h-full w-full rounded-lg object-contain"
              />
            ) : displayedSourceFailed ? (
              <div
                className="flex h-full min-h-32 w-full items-center justify-center rounded-lg bg-black/30 px-6 text-center text-sm text-white/75"
                role="img"
                aria-label={`${slideDescription} could not be loaded`}
              >
                This image could not be loaded.
              </div>
            ) : (
              <Image
                key={`${current}:${displayedSource}`}
                src={displayedSource}
                alt={imageAlternative}
                fill
                sizes="100vw"
                className="rounded-lg object-contain"
                onError={handleImageError}
                // Wikimedia renditions stay direct instead of proxying broad Commons URLs through Next.
                unoptimized
              />
            )}
          </div>

          {hasDetails ? (
            <div
              className="max-h-[min(34dvh,18rem)] overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-center sm:px-8"
              tabIndex={0}
              aria-label="Image details"
            >
              {imageStatus ? (
                <p
                  className="mx-auto max-w-lg text-sm leading-relaxed text-amber-100"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {imageStatus}
                </p>
              ) : null}
              {image.caption && (
                <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-white/80 first:mt-0">
                  {image.caption}
                </p>
              )}
              {image.attribution ? (
                <div className="mx-auto mt-3 max-w-lg">
                  <MediaAttribution
                    attribution={image.attribution}
                    inverse
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
};

export const ArticleGallery = ({ wikiPageId }: { wikiPageId: string }) => {
  const { getArticleImages } = useData();
  const [images, setImages] = useState<ArticleImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getArticleImages({ wikiPageId });
        if (!cancelled) setImages(result);
      } catch {
        // Gallery is supplemental; fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wikiPageId, getArticleImages]);

  const openLightbox = useCallback((index: number, opener: HTMLButtonElement) => {
    setLightbox({ index, opener });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  if (!loading && images.length === 0) return null;
  if (loading) return null;

  return (
    <section aria-labelledby="gallery-heading">
      <h2
        id="gallery-heading"
        className="flex items-center gap-2 font-display font-semibold text-base text-foreground mb-3"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={18}
          height={18}
          aria-hidden="true"
          className="text-muted shrink-0"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        Gallery
      </h2>
      <ul
        className="list-none p-0 m-0 grid grid-cols-2 lg:grid-cols-3 gap-3 items-start"
        role="list"
      >
        {images.map((image, i) => (
          <ImageCard
            key={image.src}
            image={image}
            index={i}
            total={images.length}
            onOpen={openLightbox}
          />
        ))}
      </ul>

      <Lightbox key={lightbox?.index} images={images} state={lightbox} onClose={closeLightbox} />
    </section>
  );
};
