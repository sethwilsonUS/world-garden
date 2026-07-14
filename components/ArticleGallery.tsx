"use client";

import { useCallback, useState } from "react";
import type { ArticleImage } from "@/lib/data-context";
import { useArticleGalleryImages } from "@/hooks/useArticleGalleryImages";
import { AdaptiveImageFrame } from "./AdaptiveImageFrame";
import {
  GalleryLightbox,
  type LightboxState,
} from "./GalleryLightbox";
import { MediaAttribution } from "./MediaAttribution";

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
              {image.videoSrc ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60">
                    <svg
                      viewBox="0 0 24 24"
                      fill="white"
                      width={22}
                      height={22}
                      aria-hidden="true"
                    >
                      <polygon points="8,5 20,12 8,19" />
                    </svg>
                  </div>
                </div>
              ) : null}
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
          {image.caption ? (
            <span className="block px-4 py-3 text-[0.8125rem] leading-[1.5] text-muted line-clamp-3">
              {image.caption}
            </span>
          ) : null}
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

export const ArticleGallery = ({ wikiPageId }: { wikiPageId: string }) => {
  const { images, loading } = useArticleGalleryImages(wikiPageId);
  const [keyedLightbox, setKeyedLightbox] = useState<{
    key: string;
    state: LightboxState;
  }>(() => ({ key: wikiPageId, state: null }));
  const lightbox =
    keyedLightbox.key === wikiPageId ? keyedLightbox.state : null;

  const openLightbox = useCallback(
    (index: number, opener: HTMLButtonElement) => {
      setKeyedLightbox({ key: wikiPageId, state: { index, opener } });
    },
    [wikiPageId],
  );

  const closeLightbox = useCallback(() => {
    setKeyedLightbox({ key: wikiPageId, state: null });
  }, [wikiPageId]);

  if (loading || images.length === 0) return null;

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
        {images.map((image, index) => (
          <ImageCard
            key={image.src}
            image={image}
            index={index}
            total={images.length}
            onOpen={openLightbox}
          />
        ))}
      </ul>

      <GalleryLightbox
        key={`${wikiPageId}:${lightbox?.index ?? "closed"}`}
        images={images}
        state={lightbox}
        onClose={closeLightbox}
      />
    </section>
  );
};
