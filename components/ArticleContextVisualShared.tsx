"use client";

import {
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

const RICH_MEDIA_ROOT_MARGIN = "400px 0px";

export const isReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useMediaQuery = (queryText: string): {
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
    if (typeof IntersectionObserver === "undefined") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setNearViewport(true);
      });
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: RICH_MEDIA_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
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
        {label}<span className="sr-only"> for {title}</span>
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
