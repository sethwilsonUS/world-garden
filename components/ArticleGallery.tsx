"use client";

import { useState, useEffect, useCallback } from "react";
import { useData } from "@/lib/data-context";
import type { ArticleImage } from "@/lib/data-context";

type LightboxState = { index: number } | null;

const ImageCard = ({
  image,
  index,
  onOpen,
}: {
  image: ArticleImage;
  index: number;
  onOpen: (index: number) => void;
}) => {
  const [error, setError] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(index)}
        className="result-link group block bg-surface-2 border-[1.5px] border-border rounded-2xl no-underline overflow-hidden transition-all duration-200 w-full text-left cursor-pointer"
      >
        {!error ? (
          <div className="relative w-full aspect-[16/9] bg-surface-3 overflow-hidden">
            <img
              src={image.src}
              alt={image.alt || image.caption || ""}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={() => setError(true)}
            />
            {image.videoSrc && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="white" width={22} height={22} aria-hidden="true">
                    <polygon points="8,5 20,12 8,19" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            role="img"
            aria-label="Image failed to load"
            className="w-full aspect-[16/9] bg-surface-3 flex items-center justify-center"
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
          <div className="px-4 py-3">
            <span className="text-[0.8125rem] leading-[1.5] text-muted line-clamp-3">
              {image.caption}
            </span>
          </div>
        )}
      </button>
    </li>
  );
};

const Lightbox = ({
  images,
  state,
  onClose,
}: {
  images: ArticleImage[];
  state: LightboxState;
  onClose: () => void;
}) => {
  const [current, setCurrent] = useState(state?.index ?? 0);

  useEffect(() => {
    if (state) setCurrent(state.index);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrent((c) => (c > 0 ? c - 1 : images.length - 1));
      if (e.key === "ArrowRight") setCurrent((c) => (c < images.length - 1 ? c + 1 : 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, images.length, onClose]);

  if (!state) return null;

  const image = images[current];
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || "Image lightbox"}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors cursor-pointer"
          aria-label="Close lightbox"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={24} height={24}>
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>

        {images.length > 1 && (
          <>
            <button
              onClick={() => setCurrent((c) => (c > 0 ? c - 1 : images.length - 1))}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 text-white/70 hover:text-white transition-colors cursor-pointer"
              aria-label="Previous image"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={28} height={28}>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => setCurrent((c) => (c < images.length - 1 ? c + 1 : 0))}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 text-white/70 hover:text-white transition-colors cursor-pointer"
              aria-label="Next image"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={28} height={28}>
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
            autoPlay
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        ) : (
          <img
            src={image.originalSrc ?? image.src}
            alt={image.alt || image.caption || ""}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        )}

        {image.caption && (
          <p className="mt-3 text-sm text-white/80 text-center max-w-lg leading-relaxed">
            {image.caption}
          </p>
        )}

        {images.length > 1 && (
          <span className="mt-2 text-xs text-white/50 font-mono">
            {current + 1} / {images.length}
          </span>
        )}
      </div>
    </div>
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

  const openLightbox = useCallback((index: number) => {
    setLightbox({ index });
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
            onOpen={openLightbox}
          />
        ))}
      </ul>

      <Lightbox images={images} state={lightbox} onClose={closeLightbox} />
    </section>
  );
};
