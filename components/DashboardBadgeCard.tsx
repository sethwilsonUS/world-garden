"use client";

import { BadgeArtwork } from "@/components/BadgeArtwork";
import {
  getAccessibleBadgeProgressLabel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
  type BadgeProgress,
} from "@/lib/badges";

type DashboardBadgeCardProps = {
  badges: BadgeProgress[];
  totalExp: number;
  unlockedBadgeCount: number;
  isLoaded: boolean;
};

export const DashboardBadgeCard = ({
  badges,
  totalExp,
  unlockedBadgeCount,
  isLoaded,
}: DashboardBadgeCardProps) => {
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
          {totalExp} total EXP
        </span>
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
          {unlockedBadgeCount} unlocked
        </span>
      </div>

      {!isLoaded ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" role="status" aria-busy="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <div className="skeleton h-10 w-10 rounded-2xl" />
              <div className="skeleton mt-4 h-4 w-24" />
              <div className="skeleton mt-3 h-3 w-full" />
              <div className="skeleton mt-2 h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {badges.map((badge) => {
            const locked = badge.level === 0;
            const label = getAccessibleBadgeProgressLabel(badge);

            return (
              <article
                key={badge.key}
                aria-label={label}
                className={`rounded-[1.35rem] border p-4 transition-colors duration-200 ${
                  locked
                    ? "border-border bg-surface text-foreground"
                    : "border-accent-border bg-accent-bg text-foreground"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`inline-flex size-12 items-center justify-center rounded-2xl border ${
                      locked
                        ? "border-border bg-surface-2 text-muted"
                        : "border-accent-border bg-surface text-accent"
                    }`}
                  >
                    <BadgeArtwork badgeKey={badge.key} className="size-7" />
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] ${
                      locked
                        ? "border-border bg-surface text-muted"
                        : "border-accent-border bg-surface text-accent"
                    }`}
                  >
                    Lvl {badge.level}
                  </span>
                </div>

                <h3 className="mt-4 font-display text-[1.14rem] font-semibold leading-[1.2] text-foreground">
                  {badge.label}
                </h3>
                <p className="mt-2 text-xs leading-[1.65] text-foreground-2">
                  {badge.description}
                </p>
                <p className="mt-3 font-mono text-[0.76rem] text-muted">
                  {badge.exp} EXP • {badge.creditedArticleCount} credited article
                  {badge.creditedArticleCount === 1 ? "" : "s"}
                </p>

                <div className="mt-4">
                  <div
                    className="h-2 overflow-hidden rounded-full bg-surface-3"
                    aria-hidden="true"
                  >
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        locked ? "bg-muted/60" : "bg-accent"
                      }`}
                      style={{ width: `${getBadgeProgressPercent(badge)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[0.75rem] leading-[1.6] text-muted">
                    {getBadgeProgressLabel(badge)}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
};
