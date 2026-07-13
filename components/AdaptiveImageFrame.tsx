"use client";

import Image, { type ImageProps } from "next/image";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzeAdaptiveImage,
  DEFAULT_ADAPTIVE_FRAME_ASPECT_RATIO,
  resolveAdaptiveImagePresentation,
  type AdaptiveImageAnalysis,
} from "@/lib/adaptive-image";

type FrameSize = { width: number; height: number };

export type AdaptiveImageFrameProps = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes: string;
  className?: string;
  fallbackFrameAspectRatio?: number;
  priority?: ImageProps["priority"];
  loading?: ImageProps["loading"];
  fetchPriority?: ImageProps["fetchPriority"];
  unoptimized?: ImageProps["unoptimized"];
  onLoad?: ImageProps["onLoad"];
  onError?: ImageProps["onError"];
  backdropImageClassName?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

const joinClasses = (...classes: Array<string | undefined>): string =>
  classes.filter(Boolean).join(" ");

const readFrameSize = (element: HTMLElement): FrameSize | null => {
  const rect = element.getBoundingClientRect();
  const width = element.clientWidth || rect.width;
  const height = element.clientHeight || rect.height;
  return width > 0 && height > 0 ? { width, height } : null;
};

export const AdaptiveImageFrame = ({
  src,
  alt,
  width,
  height,
  sizes,
  className,
  fallbackFrameAspectRatio = DEFAULT_ADAPTIVE_FRAME_ASPECT_RATIO,
  priority,
  loading,
  fetchPriority,
  unoptimized,
  onLoad,
  onError,
  backdropImageClassName,
  style,
  children,
}: AdaptiveImageFrameProps) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const [naturalSize, setNaturalSize] = useState<
    (FrameSize & { src: string }) | null
  >(null);
  const [analysis, setAnalysis] = useState<AdaptiveImageAnalysis>(() => ({
    url: src,
    hasTransparency: false,
  }));

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const nextSize = readFrameSize(frame);
      if (!nextSize) return;

      setFrameSize((current) =>
        current?.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize,
      );
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(frame);
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void analyzeAdaptiveImage(src).then((nextAnalysis) => {
      if (!cancelled) setAnalysis(nextAnalysis);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  const sourceWidth =
    typeof width === "number" && width > 0
      ? width
      : naturalSize?.src === src
        ? naturalSize.width
        : undefined;
  const sourceHeight =
    typeof height === "number" && height > 0
      ? height
      : naturalSize?.src === src
        ? naturalSize.height
        : undefined;
  const hasTransparency = analysis.url === src && analysis.hasTransparency;

  const presentation = useMemo(
    () =>
      resolveAdaptiveImagePresentation({
        sourceWidth,
        sourceHeight,
        frameWidth: frameSize?.width,
        frameHeight: frameSize?.height,
        fallbackFrameAspectRatio,
        hasTransparency,
      }),
    [
      fallbackFrameAspectRatio,
      frameSize?.height,
      frameSize?.width,
      hasTransparency,
      sourceHeight,
      sourceWidth,
    ],
  );
  const usesBackdrop = presentation.mode === "backdrop";
  const isPortraitSource =
    typeof sourceWidth === "number" &&
    typeof sourceHeight === "number" &&
    sourceHeight > sourceWidth;
  const transparentPanelStyle = hasTransparency
    ? {
        background:
          analysis.panelBackground ??
          "linear-gradient(180deg, rgba(244, 241, 232, 0.98), rgba(214, 220, 212, 0.92))",
        borderColor:
          analysis.panelBorderColor ?? "rgba(255, 255, 255, 0.14)",
      }
    : undefined;

  const foregroundImage = (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={joinClasses(
        usesBackdrop
          ? joinClasses(
              "z-[2] object-contain",
              hasTransparency ? "p-1.5 sm:p-2" : undefined,
              backdropImageClassName,
            )
          : joinClasses(
              "object-cover",
              isPortraitSource ? "object-[50%_30%]" : "object-center",
            ),
      )}
      priority={priority}
      loading={loading}
      fetchPriority={fetchPriority}
      unoptimized={unoptimized}
      onLoad={(event) => {
        const nextWidth = event.currentTarget.naturalWidth;
        const nextHeight = event.currentTarget.naturalHeight;
        if (nextWidth > 0 && nextHeight > 0) {
          setNaturalSize({ src, width: nextWidth, height: nextHeight });
        }
        onLoad?.(event);
      }}
      onError={onError}
    />
  );

  return (
    <div
      ref={frameRef}
      className={joinClasses(
        "relative isolate overflow-hidden bg-surface-3",
        className,
      )}
      style={style}
      data-adaptive-image-frame=""
      data-adaptive-image-mode={presentation.mode}
      data-adaptive-image-reason={presentation.reason}
    >
      {usesBackdrop ? (
        <>
          <Image
            src={src}
            alt=""
            aria-hidden="true"
            fill
            sizes={sizes}
            className="scale-110 object-cover blur-2xl brightness-[0.58] saturate-[0.9]"
            unoptimized={unoptimized}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 z-[1] bg-black/35"
          />
          {transparentPanelStyle ? (
            <span
              aria-hidden="true"
              className="absolute inset-2 z-[1] rounded-lg border shadow-2xl sm:inset-3"
              style={transparentPanelStyle}
            />
          ) : null}
          {foregroundImage}
        </>
      ) : (
        foregroundImage
      )}
      {children ? (
        <div className="relative z-10 h-full w-full">{children}</div>
      ) : null}
    </div>
  );
};
