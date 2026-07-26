"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

const RICH_MEDIA_ROOT_MARGIN = "400px 0px";

export type VisualLoadPhase =
  | "deferred"
  | "loading"
  | "ready"
  | "fallback"
  | "error";

export const VisualLoadStatus = ({
  phase,
  children,
  className,
  visuallyHidden = phase === "ready",
}: {
  phase: VisualLoadPhase;
  children: ReactNode;
  className?: string;
  visuallyHidden?: boolean;
}) => {
  const announcesChange = phase !== "deferred";
  const classes = [
    "context-visual-load-status",
    `context-visual-load-status-${phase}`,
    visuallyHidden ? "sr-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-visual-state={phase}
      role={announcesChange ? "status" : undefined}
      aria-live={announcesChange ? "polite" : undefined}
      aria-atomic={announcesChange ? "true" : undefined}
    >
      {phase === "loading" ? (
        <span className="context-visual-spinner" aria-hidden="true" />
      ) : phase === "fallback" || phase === "error" ? (
        <span className="context-visual-state-icon" aria-hidden="true">
          {phase === "fallback" ? "↪" : "!"}
        </span>
      ) : null}
      <span>{children}</span>
    </div>
  );
};

export const isReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useMediaQuery = (
  queryText: string,
): {
  matches: boolean;
  revision: number;
} => {
  const [state, setState] = useState({ matches: false, revision: 0 });

  useEffect(() => {
    const query = window.matchMedia(queryText);
    const update = () =>
      setState((current) =>
        current.matches === query.matches
          ? current
          : { matches: query.matches, revision: current.revision + 1 },
      );
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [queryText]);

  return state;
};

export const useNearViewport = (
  ref: RefObject<HTMLElement | null>,
): boolean => {
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || nearViewport) return;
    const disclosure = node.closest<HTMLDetailsElement>(
      "details[data-visual-aids-disclosure]",
    );
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const stopObserving = () => {
      observer?.disconnect();
      observer = null;
    };
    const startObserving = () => {
      stopObserving();
      if (disclosure && !disclosure.open) return;
      if (typeof IntersectionObserver === "undefined") {
        queueMicrotask(() => {
          if (!cancelled && (!disclosure || disclosure.open)) {
            setNearViewport(true);
          }
        });
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setNearViewport(true);
          stopObserving();
        },
        { rootMargin: RICH_MEDIA_ROOT_MARGIN },
      );
      observer.observe(node);
    };
    const handleDisclosureToggle = () => {
      if (disclosure?.open) startObserving();
      else stopObserving();
    };

    disclosure?.addEventListener("toggle", handleDisclosureToggle);
    startObserving();
    return () => {
      cancelled = true;
      disclosure?.removeEventListener("toggle", handleDisclosureToggle);
      stopObserving();
    };
  }, [nearViewport, ref]);

  return nearViewport;
};

export const countLabel = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

export const StructuredDataDisclosure = ({
  label,
  title,
  meta,
  children,
}: {
  label: string;
  title: string;
  meta: string;
  children: ReactNode;
}) => (
  <details className="context-data-disclosure">
    <summary>
      <span className="context-data-disclosure-label">
        {label}
        <span className="sr-only"> for {title}</span>
      </span>{" "}
      <span className="context-data-disclosure-meta">{meta}</span>
      <span className="context-data-disclosure-chevron" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </summary>
    <div className="context-data-disclosure-content">{children}</div>
  </details>
);
