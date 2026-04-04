"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { createPortal } from "react-dom";
import { BadgeArtwork } from "@/components/BadgeArtwork";
import { api } from "@/convex/_generated/api";
import {
  getAccessibleBadgeProgressLabel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
  type BadgeCreditEntry,
  type BadgeCreditsByBadge,
  type BadgeKey,
  type BadgeProgress,
} from "@/lib/badges";

type DashboardBadgeCardProps = {
  badges: BadgeProgress[];
  badgeCredits: BadgeCreditsByBadge;
  totalExp: number;
  unlockedBadgeCount: number;
  isLoaded: boolean;
};

type BadgeDetailsDialogProps = {
  badge: BadgeProgress;
  credits: BadgeCreditEntry[];
  onClose: () => void;
};

const formatBadgeCreditDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const BadgeDetailsDialog = ({
  badge,
  credits,
  onClose,
}: BadgeDetailsDialogProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const articlesId = useId();
  const { isSignedIn } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const canUseAccountApi = Boolean(isSignedIn && isAuthenticated);
  const locked = badge.level === 0;
  const progressLabel = getBadgeProgressLabel(badge);
  const progressCurrent = locked ? badge.exp : badge.expIntoLevel;
  const progressMax = locked ? badge.nextLevelTarget : badge.expForNextLevel;
  const liveCredits = useQuery(
    api.badges.getViewerBadgeCreditsByKey,
    canUseAccountApi ? { badgeKey: badge.key } : "skip",
  );
  const resolvedCredits = liveCredits ?? credits;
  const creditsAreLoading = canUseAccountApi && liveCredits === undefined;
  const hasCreditMismatch =
    !creditsAreLoading &&
    resolvedCredits.length === 0 &&
    badge.creditedArticleCount > 0;
  const dialogShellClass = locked
    ? "border-border bg-surface text-foreground"
    : "border-accent-border bg-surface text-foreground shadow-[0_18px_48px_var(--color-accent-glow)]";
  const iconShellClass = locked
    ? "border-border bg-surface text-muted"
    : "border-accent-border bg-surface text-accent";
  const pillClass = locked
    ? "border-border bg-surface text-muted"
    : "border-accent-border bg-surface text-accent";
  const progressTrackClass = locked
    ? "bg-surface-3 ring-border"
    : "bg-surface/75 ring-accent-border";
  const progressFillClass = locked ? "bg-muted/60" : "bg-accent";

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusCloseButton = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label={`Close ${badge.label} badge details`}
        className="absolute inset-0 bg-black/60"
        style={{
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      />
      <div className="absolute inset-0 flex items-center justify-center px-4 py-5 pointer-events-none">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`scrollbar-subtle pointer-events-auto relative w-full max-w-xl overflow-y-auto rounded-[1.6rem] border ${dialogShellClass}`}
          style={{ maxHeight: "min(90vh, calc(100vh - 2.5rem))" }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-90"
            style={{
              background: locked
                ? "radial-gradient(circle at top left, var(--color-surface-2), transparent 72%)"
                : "radial-gradient(circle at top left, var(--color-accent-glow), transparent 72%)",
            }}
          />

          <div className="relative p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <div
                  className={`relative inline-flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-[1.35rem] border shadow-sm ${iconShellClass}`}
                >
                  <div
                    aria-hidden="true"
                    className={`absolute inset-[7px] rounded-[1.05rem] ${
                      locked ? "bg-surface-2" : "bg-accent-bg"
                    }`}
                  />
                  <BadgeArtwork badgeKey={badge.key} className="relative size-10" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted">
                    Badge details
                  </p>
                  <h2
                    id={titleId}
                    className="mt-2 font-display text-[1.55rem] font-semibold leading-[1.08] text-foreground"
                  >
                    {badge.label}
                  </h2>
                </div>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label={`Close ${badge.label} badge details`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors duration-200 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={18}
                  height={18}
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <p
              id={descriptionId}
              className="mt-5 text-[0.98rem] leading-[1.75] text-foreground-2"
            >
              {badge.description}
            </p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${pillClass}`}
              >
                Lvl {badge.level}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${pillClass}`}
              >
                {badge.exp} EXP
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">
                {badge.creditedArticleCount} article
                {badge.creditedArticleCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-5 rounded-[1.2rem] border border-border bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">
                  Progress
                </p>
                <p className="font-mono text-[0.72rem] text-muted">
                  {progressLabel}
                </p>
              </div>

              <div className="mt-3">
                <div
                  role="progressbar"
                  aria-label={`${badge.label} badge progress`}
                  aria-valuemin={0}
                  aria-valuemax={progressMax}
                  aria-valuenow={progressCurrent}
                  aria-valuetext={progressLabel}
                  className={`relative h-3 overflow-hidden rounded-full ring-1 ${progressTrackClass}`}
                >
                  <div
                    className={`relative h-full rounded-full transition-[width] duration-500 ${progressFillClass}`}
                    style={{ width: `${getBadgeProgressPercent(badge)}%` }}
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 opacity-60"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 48%, transparent 100%)",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <section aria-labelledby={articlesId} className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3
                  id={articlesId}
                  className="font-display text-[1.18rem] font-semibold leading-[1.2] text-foreground"
                >
                  Contributing articles
                </h3>
                {resolvedCredits.length > 1 ? (
                  <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted">
                    Most recent first
                  </p>
                ) : null}
              </div>

              {creditsAreLoading ? (
                <p className="mt-3 rounded-[1.05rem] border border-border bg-surface-2 px-4 py-3 text-sm leading-[1.7] text-foreground-2">
                  Loading credited articles...
                </p>
              ) : hasCreditMismatch ? (
                <p className="mt-3 rounded-[1.05rem] border border-dashed border-serious/40 bg-surface-2 px-4 py-3 text-sm leading-[1.7] text-foreground-2">
                  This badge already has {badge.creditedArticleCount} credited
                  article{badge.creditedArticleCount === 1 ? "" : "s"}, but
                  their titles have not synced into the modal yet.
                </p>
              ) : resolvedCredits.length === 0 ? (
                <p className="mt-3 rounded-[1.05rem] border border-dashed border-border bg-surface-2 px-4 py-3 text-sm leading-[1.7] text-foreground-2">
                  No articles have credited this badge yet. Listen to a matching
                  article page until you have heard 80% of its playable audio to
                  earn the first EXP.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 pb-6 sm:pb-7">
                  {resolvedCredits.map((credit) => (
                    <li key={`${credit.slug}-${credit.earnedAt}`}>
                      <Link
                        href={`/article/${credit.slug}`}
                        onClick={onClose}
                        className="group flex min-h-11 items-start justify-between gap-3 rounded-[1rem] border border-border bg-surface-2 px-3.5 py-3 text-left no-underline transition-colors duration-200 hover:border-accent-border hover:bg-accent-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm leading-[1.45] text-foreground">
                            {credit.title}
                          </span>
                          <span className="mt-1 block font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted">
                            Listened on {formatBadgeCreditDate(credit.earnedAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 shrink-0 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted transition-colors duration-200 group-hover:text-accent">
                          View
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const DashboardBadgeCard = ({
  badges,
  badgeCredits,
  totalExp,
  unlockedBadgeCount,
  isLoaded,
}: DashboardBadgeCardProps) => {
  const badgeGridClass = "mt-6 grid gap-3 sm:grid-cols-2";
  const [selectedBadgeKey, setSelectedBadgeKey] = useState<BadgeKey | null>(null);
  const triggerRefs = useRef<Partial<Record<BadgeKey, HTMLButtonElement | null>>>(
    {},
  );
  const lastFocusedBadgeKeyRef = useRef<BadgeKey | null>(null);

  useEffect(() => {
    if (selectedBadgeKey !== null) return;
    const badgeKey = lastFocusedBadgeKeyRef.current;
    if (!badgeKey) return;
    triggerRefs.current[badgeKey]?.focus();
  }, [selectedBadgeKey]);

  const selectedBadge = selectedBadgeKey
    ? badges.find((badge) => badge.key === selectedBadgeKey) ?? null
    : null;

  return (
    <article className="garden-bed p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Signed-in progress
          </p>
          <h2 className="mt-2 font-display text-[1.5rem] font-semibold leading-[1.15] text-foreground">
            Badges
          </h2>
        </div>
        <span className="inline-flex shrink-0 rounded-full border border-accent-border bg-accent-bg px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent">
          Growing now
        </span>
      </div>

      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
        Each badge tracks broad Wikipedia topic families. A qualifying article
        is worth 1 EXP per matching badge once you have actually heard 80% of
        its playable audio. No free lunch for the skip goblin.
      </p>

      <p className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-[1.7] text-foreground-2">
        Badge EXP only comes from listening on article pages while signed in.
        Podcast plays in podcast apps do not count toward badges yet.
      </p>

      <div className="mt-5 flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
          {totalExp} EXP
        </span>
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
          {unlockedBadgeCount} unlocked
        </span>
      </div>

      {!isLoaded ? (
        <div className={badgeGridClass} role="status" aria-busy="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <div className="skeleton h-5 w-24" />
              <div className="skeleton mx-auto mt-6 h-24 w-24 rounded-[1.6rem]" />
              <div className="skeleton mt-6 h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className={badgeGridClass}>
          {badges.map((badge) => {
            const locked = badge.level === 0;
            const progressLabel = getBadgeProgressLabel(badge);
            const accessibleLabel = `Open ${badge.label} badge details. ${getAccessibleBadgeProgressLabel(badge)}`;
            const cardShellClass = locked
              ? "border-border bg-surface text-foreground"
              : "border-accent-border bg-accent-bg text-foreground shadow-[0_12px_30px_var(--color-accent-glow)]";
            const iconShellClass = locked
              ? "border-border bg-surface text-muted"
              : "border-accent-border bg-surface text-accent";
            const progressTrackClass = locked
              ? "bg-surface-3 ring-border"
              : "bg-surface/75 ring-accent-border";
            const progressFillClass = locked ? "bg-muted/60" : "bg-accent";

            return (
              <button
                key={badge.key}
                type="button"
                ref={(node) => {
                  triggerRefs.current[badge.key] = node;
                }}
                onClick={() => {
                  lastFocusedBadgeKeyRef.current = badge.key;
                  setSelectedBadgeKey(badge.key);
                }}
                aria-label={accessibleLabel}
                aria-haspopup="dialog"
                className={`group relative flex min-h-[14.5rem] w-full cursor-pointer flex-col overflow-hidden rounded-[1.35rem] border p-4 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${cardShellClass}`}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-90"
                  style={{
                    background: locked
                      ? "radial-gradient(circle at top left, var(--color-surface-2), transparent 68%)"
                      : "radial-gradient(circle at top left, var(--color-accent-glow), transparent 68%)",
                  }}
                />

                <span className="relative flex h-full flex-col">
                  <span className="font-display text-[1.14rem] font-semibold leading-[1.15] text-foreground">
                    {badge.label}
                  </span>

                  <span className="flex flex-1 items-center justify-center py-4">
                    <span
                      className={`relative inline-flex size-24 items-center justify-center rounded-[1.7rem] border shadow-sm transition-transform duration-200 group-hover:scale-[1.03] ${iconShellClass}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-[8px] rounded-[1.25rem] ${
                          locked ? "bg-surface-2" : "bg-accent-bg"
                        }`}
                      />
                      <BadgeArtwork badgeKey={badge.key} className="relative size-14" />
                    </span>
                  </span>

                  <span className="mt-auto block">
                    <span className="sr-only">{progressLabel}</span>
                    <span
                      className={`block h-2.5 overflow-hidden rounded-full ring-1 ${progressTrackClass}`}
                    >
                      <span
                        className={`relative block h-full rounded-full transition-[width] duration-500 ${progressFillClass}`}
                        style={{ width: `${getBadgeProgressPercent(badge)}%` }}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 opacity-60"
                          style={{
                            background:
                              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 48%, transparent 100%)",
                          }}
                        />
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedBadge ? (
        <BadgeDetailsDialog
          badge={selectedBadge}
          credits={badgeCredits[selectedBadge.key] ?? []}
          onClose={() => setSelectedBadgeKey(null)}
        />
      ) : null}
    </article>
  );
};
