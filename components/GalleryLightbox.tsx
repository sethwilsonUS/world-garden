"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import type { ArticleImage } from "@/lib/data-context";
import { MediaAttribution } from "./MediaAttribution";

export type LightboxState = {
  index: number;
  opener?: HTMLElement | null;
} | null;

const navigationIgnoredTags = new Set([
  "AUDIO",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "VIDEO",
]);

const shouldIgnoreNavigation = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return (
    navigationIgnoredTags.has(target.tagName) ||
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

const getImageAlt = (image: ArticleImage): string => {
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

export const GalleryLightbox = ({
  images,
  state,
  onClose,
}: {
  images: ArticleImage[];
  state: LightboxState;
  onClose: () => void;
}) => {
  const requestedIndex = state?.index ?? 0;
  const [navigation, setNavigation] = useState(() => ({
    requestedIndex,
    current: requestedIndex,
  }));
  const current =
    navigation.requestedIndex === requestedIndex
      ? navigation.current
      : requestedIndex;
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
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (dialog.open) dialog.close();
      openerRef.current?.focus();
    };
  }, [state?.opener]);

  const showPrevious = useCallback(() => {
    setNavigation((previous) => {
      const value =
        previous.requestedIndex === requestedIndex
          ? previous.current
          : requestedIndex;
      return {
        requestedIndex,
        current: value > 0 ? value - 1 : images.length - 1,
      };
    });
  }, [images.length, requestedIndex]);

  const showNext = useCallback(() => {
    setNavigation((previous) => {
      const value =
        previous.requestedIndex === requestedIndex
          ? previous.current
          : requestedIndex;
      return {
        requestedIndex,
        current: value < images.length - 1 ? value + 1 : 0,
      };
    });
  }, [images.length, requestedIndex]);

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDialogElement>) => {
      if (images.length <= 1 || shouldIgnoreNavigation(event.target)) return;
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

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (shouldIgnoreNavigation(event.target)) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (!touchStartRef.current || images.length <= 1) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) showNext();
      else showPrevious();
    },
    [images.length, showNext, showPrevious],
  );

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
  const imageAlternative = getImageAlt(image);

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
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby={titleId}
    >
      <div
        className="flex h-full w-full items-center justify-center bg-black/85"
        style={{
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="grid h-full min-h-0 w-[calc(100%_-_1rem)] max-w-[100rem] grid-rows-[auto_minmax(0,1fr)_auto] sm:w-[calc(100%_-_2rem)]">
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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                width={24}
                height={24}
                aria-hidden="true"
              >
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
            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={showPrevious}
                  className="absolute left-1 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:left-3"
                  aria-label="Previous image"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    width={28}
                    height={28}
                    aria-hidden="true"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={showNext}
                  className="absolute right-1 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:right-3"
                  aria-label="Next image"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    width={28}
                    height={28}
                    aria-hidden="true"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </>
            ) : null}

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
              {image.caption ? (
                <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-white/80 first:mt-0">
                  {image.caption}
                </p>
              ) : null}
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
