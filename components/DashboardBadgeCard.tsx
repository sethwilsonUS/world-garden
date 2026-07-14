"use client";

import { useCallback, useState } from "react";
import { BadgeArtwork } from "@/components/BadgeArtwork";
import { BadgeDetailsDialog } from "@/components/BadgeDetailsDialog";
import {
  getAccessibleBadgeProgressLabel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
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
  headingId?: string;
};

export const DashboardBadgeCard = ({
  badges,
  badgeCredits,
  totalExp,
  unlockedBadgeCount,
  isLoaded,
  headingId,
}: DashboardBadgeCardProps) => {
  const badgeGridClass = "mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3";
  const [selectedBadgeKey, setSelectedBadgeKey] = useState<BadgeKey | null>(null);
  const selectedBadge = selectedBadgeKey
    ? badges.find((badge) => badge.key === selectedBadgeKey) ?? null
    : null;
  const closeBadgeDialog = useCallback(() => {
    setSelectedBadgeKey(null);
  }, []);

  return (
    <article className="garden-bed p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Signed-in progress
          </p>
          <h2
            id={headingId}
            className="mt-2 font-display text-[1.5rem] font-semibold leading-[1.15] text-foreground"
          >
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
                onClick={() => setSelectedBadgeKey(badge.key)}
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
          onClose={closeBadgeDialog}
        />
      ) : null}
    </article>
  );
};
