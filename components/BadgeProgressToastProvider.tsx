"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BadgeArtwork } from "@/components/BadgeArtwork";
import {
  getAccessibleBadgeProgressLabel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
  type AwardedBadgeProgress,
} from "@/lib/badges";

const MAX_TOASTS = 4;

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

const emptySubscribe = () => () => {};

const createAnnouncement = (
  articleTitle: string,
  badge: AwardedBadgeProgress,
): string => {
  if (badge.leveledUp) {
    return `${badge.label} badge reached level ${badge.level} from ${articleTitle}.`;
  }

  return `${badge.label} badge gained 1 EXP from ${articleTitle}. ${getBadgeProgressLabel(badge)}.`;
};

const LevelUpBurstIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1L6.5 8.5l4.1-1.4Z" />
    <path d="M19 4v3" />
    <path d="M20.5 5.5h-3" />
    <path d="M5 16v2.5" />
    <path d="M6.2 17.2H3.8" />
  </svg>
);

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
  const statusLabel = toast.badge.leveledUp
    ? "Badge leveled up"
    : "Badge progress";
  const statusChipLabel = toast.badge.leveledUp
    ? `Level ${toast.badge.level}`
    : `Lvl ${toast.badge.level}`;
  const timestampLabel = new Date(toast.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article
      aria-label={accessibilityLabel}
      className="pointer-events-auto garden-bed w-full max-w-[26rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.16)]"
    >
      <div className="p-4 sm:p-4.5">
        <div className="flex items-start gap-3">
          <div
            className="relative mt-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-accent-border bg-accent-bg text-accent"
          >
            <BadgeArtwork badgeKey={toast.badge.key} className="size-7" />
            {toast.badge.leveledUp ? (
              <span
                data-level-up-icon="true"
                className="absolute -right-1.5 -top-1.5 inline-flex size-6 items-center justify-center rounded-full border border-accent-border bg-surface text-accent shadow-[0_8px_18px_rgba(0,0,0,0.12)]"
              >
                <LevelUpBurstIcon />
              </span>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
              {statusLabel}
            </p>
            <h2 className="mt-1 font-display text-[1.02rem] leading-[1.2] text-foreground">
              {toast.badge.label}
            </h2>
            <p className="mt-2 text-sm leading-[1.6] text-foreground-2">
              {toast.badge.leveledUp
                ? `${toast.articleTitle} pushed ${toast.badge.label} from level ${toast.badge.previousLevel} to level ${toast.badge.level}.`
                : `+1 EXP from ${toast.articleTitle}.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted transition-colors duration-200 hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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

          <div className="mt-2 rounded-full bg-surface-3 p-1" aria-hidden="true">
            <div
              className="h-2 rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm font-semibold text-accent">
            {statusChipLabel}
          </span>
          {toast.badge.leveledUp ? (
            <span className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-foreground-2">
              Up from Lvl {toast.badge.previousLevel}
            </span>
          ) : null}
          <span className="text-xs text-muted">
            {timestampLabel}
          </span>
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
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
  const hasMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [toasts, setToasts] = useState<BadgeToast[]>([]);
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
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
    },
    [],
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
      {hasMounted
        ? createPortal(
            <BadgeProgressToastTray
              toasts={toasts}
              onDismiss={dismissToast}
              politeAnnouncement={politeAnnouncement}
            />,
            document.body,
          )
        : null}
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
