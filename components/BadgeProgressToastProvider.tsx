"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BadgeArtwork } from "@/components/BadgeArtwork";
import {
  getAccessibleBadgeProgressLabel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
  type AwardedBadgeProgress,
} from "@/lib/badges";

const MAX_TOASTS = 4;
const TOAST_DURATION_MS = 9_000;

type BadgeToast = {
  id: string;
  articleTitle: string;
  badge: AwardedBadgeProgress;
  createdAt: number;
};

type BadgeProgressToastContextValue = {
  showBadgeProgressToasts: (args: {
    articleTitle: string;
    badges: AwardedBadgeProgress[];
  }) => void;
};

const defaultBadgeProgressToastContext: BadgeProgressToastContextValue = {
  showBadgeProgressToasts: () => {},
};

const BadgeProgressToastContext = createContext<BadgeProgressToastContextValue>(
  defaultBadgeProgressToastContext,
);

const createAnnouncement = (
  articleTitle: string,
  badge: AwardedBadgeProgress,
): string => {
  if (badge.leveledUp) {
    return `${badge.label} badge reached level ${badge.level} from ${articleTitle}.`;
  }

  return `${badge.label} badge gained 1 EXP from ${articleTitle}. ${getBadgeProgressLabel(badge)}.`;
};

const BadgeProgressToastCard = ({
  toast,
  onDismiss,
}: {
  toast: BadgeToast;
  onDismiss: (id: string) => void;
}) => {
  const progressLabel = getBadgeProgressLabel(toast.badge);
  const progressPercent = getBadgeProgressPercent(toast.badge);
  const accessibilityLabel = `${getAccessibleBadgeProgressLabel(toast.badge)} Credited from ${toast.articleTitle}.`;

  return (
    <article
      aria-label={accessibilityLabel}
      className="pointer-events-auto garden-bed w-full max-w-[24rem] overflow-hidden border border-[color:rgba(147,164,151,0.22)] bg-[linear-gradient(180deg,rgba(247,244,236,0.98),rgba(232,238,229,0.96))] shadow-[0_18px_45px_rgba(28,33,32,0.18)]"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-accent-border bg-[color:rgba(255,255,255,0.72)] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <BadgeArtwork badgeKey={toast.badge.key} className="size-7" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">
                {toast.badge.leveledUp ? "Level up" : "Badge progress"}
              </p>
              <span className="inline-flex rounded-full border border-accent-border bg-[color:rgba(255,255,255,0.72)] px-2 py-0.5 font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] text-accent">
                Lvl {toast.badge.level}
              </span>
            </div>

            <h2 className="mt-1 font-display text-[1.1rem] leading-[1.15] text-foreground">
              {toast.badge.label}
            </h2>
            <p className="mt-1 text-sm leading-[1.55] text-foreground-2">
              {toast.badge.leveledUp
                ? `You hit level ${toast.badge.level} by finishing enough of ${toast.articleTitle}.`
                : `+1 EXP from ${toast.articleTitle}.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/80 bg-[color:rgba(255,255,255,0.72)] text-muted transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[color:rgba(244,246,241,0.96)]"
            aria-label={`Dismiss badge progress for ${toast.badge.label}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={16}
              height={16}
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-[0.76rem] text-muted">
            <span className="font-mono">
              {toast.badge.exp} EXP total
            </span>
            <span>{progressLabel}</span>
          </div>

          <div className="mt-2 rounded-full bg-[color:rgba(52,73,64,0.12)] p-1" aria-hidden="true">
            <div
              className={`h-2 rounded-full transition-[width] duration-500 ${
                toast.badge.leveledUp ? "bg-accent" : "bg-[color:rgba(95,123,109,0.82)]"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  );
};

const BadgeProgressToastTray = ({
  toasts,
  onDismiss,
  politeAnnouncement,
}: {
  toasts: BadgeToast[];
  onDismiss: (id: string) => void;
  politeAnnouncement: string;
}) => {
  return (
    <>
      <div className="sr-only" aria-live="polite" role="status">
        {politeAnnouncement}
      </div>

      {toasts.length > 0 ? (
        <section
          aria-label="Badge progress"
          className="pointer-events-none fixed inset-x-4 top-4 z-[72] flex flex-col items-end gap-3 sm:top-5"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {toasts.map((toast) => (
            <BadgeProgressToastCard
              key={toast.id}
              toast={toast}
              onDismiss={onDismiss}
            />
          ))}
        </section>
      ) : null}
    </>
  );
};

export const BadgeProgressToastProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [toasts, setToasts] = useState<BadgeToast[]>([]);
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
  const timeoutIdsRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;

    return () => {
      for (const timeoutId of timeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, []);

  const showBadgeProgressToasts = useCallback(
    ({
      articleTitle,
      badges,
    }: {
      articleTitle: string;
      badges: AwardedBadgeProgress[];
    }) => {
      if (badges.length === 0) return;

      const createdAt = Date.now();
      const incomingToasts = badges.map((badge, index) => ({
        id: `badge-progress-${badge.key}-${createdAt}-${index}`,
        articleTitle,
        badge,
        createdAt: createdAt + index,
      }));

      setToasts((current) => [...incomingToasts, ...current].slice(0, MAX_TOASTS));
      setPoliteAnnouncement(createAnnouncement(articleTitle, badges[0]));

      for (const toast of incomingToasts) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(toast.id);
        }, TOAST_DURATION_MS);
        timeoutIdsRef.current.set(toast.id, timeoutId);
      }
    },
    [dismissToast],
  );

  const value = useMemo<BadgeProgressToastContextValue>(
    () => ({
      showBadgeProgressToasts,
    }),
    [showBadgeProgressToasts],
  );

  return (
    <BadgeProgressToastContext.Provider value={value}>
      {children}
      <BadgeProgressToastTray
        toasts={toasts}
        onDismiss={dismissToast}
        politeAnnouncement={politeAnnouncement}
      />
    </BadgeProgressToastContext.Provider>
  );
};

export const BadgeProgressToastFallbackProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const value = useMemo<BadgeProgressToastContextValue>(
    () => ({
      showBadgeProgressToasts: () => {},
    }),
    [],
  );

  return (
    <BadgeProgressToastContext.Provider value={value}>
      {children}
    </BadgeProgressToastContext.Provider>
  );
};

export const useBadgeProgressToasts = () => {
  return useContext(BadgeProgressToastContext);
};
