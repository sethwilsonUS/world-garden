"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { DashboardBadgeCard } from "@/components/DashboardBadgeCard";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useBadges } from "@/hooks/useBadges";
import { usePersonalPlaylist } from "@/hooks/usePersonalPlaylist";
import { analytics } from "@/lib/analytics";
import { PodcastFeedActions } from "@/components/PodcastFeedActions";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const librarySummary = (count: number, isLoaded: boolean) => {
  if (!isLoaded) {
    return "Syncing your saved articles and account bookmark state.";
  }

  if (count === 0) {
    return "Your synced library is ready. Save an article and it will appear here.";
  }

  return `${count} saved article${count === 1 ? "" : "s"} waiting in your synced library.`;
};

const accountDisplayName = (user: ReturnType<typeof useUser>["user"]) => {
  return (
    user?.firstName ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there"
  );
};

const playlistSummary = ({
  entryCount,
  isAvailable,
  isLoaded,
  readyCount,
}: {
  entryCount: number;
  isAvailable: boolean;
  isLoaded: boolean;
  readyCount: number;
}) => {
  if (!isLoaded) {
    return "Syncing your queue, feed status, and episode generation progress.";
  }

  if (!isAvailable) {
    return "Your account is still connecting the playlist queue to Convex.";
  }

  if (entryCount === 0) {
    return "Your listen-next queue is ready. Add an article anywhere in Curio Garden to start building your personal feed.";
  }

  return `${entryCount} queued item${entryCount === 1 ? "" : "s"}, with ${readyCount} ready for your personal feed right now.`;
};

const badgesSummary = ({
  isLoaded,
  totalExp,
  unlockedBadgeCount,
}: {
  isLoaded: boolean;
  totalExp: number;
  unlockedBadgeCount: number;
}) => {
  if (!isLoaded) {
    return "Loading your signed-in listening progress and topic badge totals.";
  }

  if (totalExp === 0) {
    return "Your first badge EXP will land after you listen to enough of an article page while signed in.";
  }

  return `${totalExp} total EXP across ${unlockedBadgeCount} unlocked badge${unlockedBadgeCount === 1 ? "" : "s"}.`;
};

const SignInCta = ({
  label,
  className,
}: {
  label: string;
  className: string;
}) => {
  return (
    <SignInButton>
      <button className={className}>{label}</button>
    </SignInButton>
  );
};

const SectionShell = ({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) => {
  return (
    <section aria-labelledby="dashboard-heading" className="mb-8">
      <p className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        {eyebrow}
      </p>
      <h1
        id="dashboard-heading"
        className="mt-4 font-display text-[2rem] sm:text-[2.45rem] font-bold text-foreground leading-[1.05]"
      >
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-[1.04rem] leading-[1.78] text-foreground-2">
        {description}
      </p>
      <div className="mt-8">{children}</div>
    </section>
  );
};

const DashboardSummaryCard = ({
  eyebrow,
  title,
  description,
  detail,
  action,
  accent = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  detail: ReactNode;
  action: ReactNode;
  accent?: boolean;
}) => {
  return (
    <article
      className={`garden-bed flex h-full flex-col p-6 ${
        accent ? "border-accent-border bg-accent-bg" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
          {eyebrow}
        </p>
        <h2 className="mt-2 font-display text-[1.35rem] font-semibold leading-[1.2] text-foreground">
          {title}
        </h2>
      </div>
      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">{description}</p>
      <div className="mt-4 text-sm leading-[1.7] text-muted">{detail}</div>
      <div className="mt-auto pt-6">{action}</div>
    </article>
  );
};

const FeatureCard = ({
  title,
  status,
  description,
  detail,
  action,
  accent = false,
}: {
  title: string;
  status: string;
  description: string;
  detail: string;
  action?: React.ReactNode;
  accent?: boolean;
}) => {
  return (
    <article
      className={`garden-bed h-full p-6 ${
        accent ? "border-accent-border bg-accent-bg" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            {status}
          </p>
          <h2 className="mt-2 font-display text-[1.35rem] font-semibold leading-[1.2] text-foreground">
            {title}
          </h2>
        </div>
        {accent ? (
          <span className="inline-flex shrink-0 rounded-full border border-accent-border bg-accent-bg px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent">
            Ready now
          </span>
        ) : (
          <span className="inline-flex shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Coming soon
          </span>
        )}
      </div>

      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">{description}</p>
      <p className="mt-4 text-sm leading-[1.7] text-muted">{detail}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </article>
  );
};

const QueueActionButton = ({
  label,
  ariaLabel,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={label}
      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
};

const playlistStatusLabel = (status: string): string => {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Generating";
    case "ready":
      return "Ready";
    case "failed":
      return "Needs retry";
    default:
      return "Pending";
  }
};

const playlistStageLabel = (entry: {
  status: string;
  stage?: "queued" | "rendering_audio" | "packaging";
}): string => {
  if (entry.status === "ready") return "Ready";
  if (entry.status === "failed") return "Needs retry";
  if (entry.stage === "packaging") return "Packaging MP3";
  if (entry.status === "queued") return "Queued";
  if (entry.stage === "rendering_audio") return "Rendering audio";
  if (entry.status === "running") return "Generating";
  return playlistStatusLabel(entry.status);
};

const playlistProgressLabel = (entry: {
  status: string;
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount?: number;
  completedSectionCount?: number;
  lastError?: string;
}): string => {
  if (entry.status === "failed") {
    return entry.lastError || "Episode generation failed. Retry when ready.";
  }
  if (entry.status === "ready") {
    return "Episode is ready for your feed and podcast app.";
  }
  if (entry.status === "queued") {
    return "Waiting for earlier playlist items to finish generating.";
  }
  if (entry.stage === "packaging") {
    return "Stitching sections into one podcast-ready MP3.";
  }
  if ((entry.sectionCount ?? 0) > 0) {
    return `${Math.min(entry.completedSectionCount ?? 0, entry.sectionCount ?? 0)} of ${entry.sectionCount} sections ready`;
  }
  return "Preparing article audio in the background.";
};

const playlistProgressPercent = (entry: {
  status: string;
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount?: number;
  completedSectionCount?: number;
}): number | null => {
  if (entry.status !== "running") return null;
  if (entry.stage === "packaging") return 100;
  if (!entry.sectionCount || entry.sectionCount <= 0) return null;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(((entry.completedSectionCount ?? 0) / entry.sectionCount) * 100),
    ),
  );
};

type DashboardPlaylistCardProps = Pick<
  ReturnType<typeof usePersonalPlaylist>,
  "entries" | "feedUrl" | "isAvailable" | "isLoaded" | "moveDown" | "moveUp" | "remove" | "retry"
> & {
  headingId?: string;
};

const DashboardPlaylistCard = ({
  entries,
  feedUrl,
  isAvailable,
  isLoaded,
  moveDown,
  moveUp,
  remove,
  retry,
  headingId,
}: DashboardPlaylistCardProps) => {
  const readyCount = entries.filter((entry) => entry.status === "ready").length;

  return (
    <article className="garden-bed h-full p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Personalized queue
          </p>
          <h2
            id={headingId}
            className="mt-2 font-display text-[1.5rem] font-semibold leading-[1.15] text-foreground"
          >
            Playlist
          </h2>
        </div>
        <span className="inline-flex shrink-0 rounded-full border border-accent-border bg-accent-bg px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent">
          {entries.length === 0 ? "Ready to plant" : `${entries.length} in queue`}
        </span>
      </div>

      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
        Playlist is separate from Library. Save something to Library when you
        want to keep it around; add it here when you want it generated as a
        listen-next podcast episode in your personal feed.
      </p>

      {!isLoaded ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5" role="status">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton mt-3 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-[82%]" />
        </div>
      ) : !isAvailable ? (
        <div className="mt-6 rounded-2xl border border-amber-400/30 bg-surface px-5 py-6">
          <p className="font-display text-lg font-semibold text-foreground">
            Playlist is waiting on account sync
          </p>
          <p className="mt-2 text-sm leading-[1.7] text-muted">
            You&apos;re signed in with Clerk, but this session has not finished
            connecting to Convex yet. Refresh in a moment, and if it keeps
            happening, double-check the Clerk-to-Convex setup.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface px-5 py-6">
          <p className="font-display text-lg font-semibold text-foreground">
            Your queue is empty
          </p>
          <p className="mt-2 text-sm leading-[1.7] text-muted">
            Add articles while browsing and they&apos;ll show up here in order.
            The first add also creates your personal RSS feed.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3" role="list">
          {entries.map((entry, index) => (
            <li key={entry._id}>
              <div className="rounded-2xl border border-border bg-surface px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-surface-2 px-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted">
                        #{index + 1}
                      </span>
                      <span className="inline-flex min-h-7 items-center rounded-full border border-accent-border bg-accent-bg px-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-accent">
                        {playlistStageLabel(entry)}
                      </span>
                    </div>
                    <Link
                      href={`/article/${encodeURIComponent(entry.slug)}`}
                      className="mt-3 block font-display text-[1.05rem] font-semibold leading-[1.3] text-foreground no-underline"
                    >
                      {entry.title}
                    </Link>
                    <p className="mt-2 text-sm leading-[1.6] text-muted">
                      {playlistProgressLabel(entry)}
                    </p>
                    {playlistProgressPercent(entry) != null ? (
                      <div className="mt-3 max-w-sm">
                        <div
                          aria-label={`Generation progress for ${entry.title}`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={playlistProgressPercent(entry) ?? 0}
                          role="progressbar"
                          className="h-2 overflow-hidden rounded-full bg-surface-2"
                        >
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-300"
                            style={{ width: `${playlistProgressPercent(entry)}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <QueueActionButton
                      label="Move earlier"
                      ariaLabel={`Move ${entry.title} earlier in the playlist`}
                      onClick={() => void moveUp(entry._id, entry.title)}
                      disabled={index === 0}
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
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                    </QueueActionButton>
                    <QueueActionButton
                      label="Move later"
                      ariaLabel={`Move ${entry.title} later in the playlist`}
                      onClick={() => void moveDown(entry._id, entry.title)}
                      disabled={index === entries.length - 1}
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
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </QueueActionButton>
                    {entry.status === "failed" ? (
                      <button
                        type="button"
                        onClick={() => void retry(entry._id, entry.title)}
                        className="btn-secondary inline-flex min-h-10 items-center justify-center px-4 py-2 text-sm"
                      >
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void remove(entry._id, entry.title)}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-2"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-border pt-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-muted">
            {readyCount} ready episode{readyCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-muted">
            RSS stays in sync with your current queue
          </span>
        </div>

        {feedUrl ? (
          <>
            <code
              aria-label="Personal playlist feed URL"
              className="mt-4 block overflow-x-auto rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground"
            >
              {feedUrl}
            </code>
            <PodcastFeedActions
              feedUrl={feedUrl}
              feedTitle="Personal Playlist"
            />
          </>
        ) : (
          <p className="mt-4 text-sm leading-[1.7] text-muted">
            Add your first article to create the personal RSS feed URL you can
            paste into Apple Podcasts or any app that follows RSS by URL.
          </p>
        )}
      </div>
    </article>
  );
};

const SignedOutDashboardTeaser = () => {
  return (
    <>
      <SectionShell
        eyebrow="Account hub"
        title="Sign in to open your dashboard"
        description="Use one sign-in flow for everything: returning users can pick Google or email, and new users can create an account from that same sign-in screen."
      >
        <div className="garden-bed pattern-leaves p-6 sm:p-7">
          <p className="text-sm leading-[1.8] text-foreground-2">
            New here? Continue with Google or create an email account in the
            sign-in flow. Your guest library still works without an account, but
            signing in unlocks a synced home for future features.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <SignInCta
              label="Sign in"
              className="btn-primary inline-flex min-h-11 items-center justify-center px-6 py-3 text-sm"
            />
            <Link
              href="/library"
              className="btn-secondary inline-flex min-h-11 items-center justify-center px-6 py-3 text-sm no-underline"
            >
              Open Library
            </Link>
          </div>
        </div>
      </SectionShell>

      <section
        aria-label="Dashboard feature preview"
        className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      >
        <FeatureCard
          title="Library"
          status="Available today"
          description="Save articles as you browse. Guests keep bookmarks on this device, and signed-in readers get a synced library across sessions."
          detail="This remains the working saved-items page right now."
          action={
            <Link
              href="/library"
              className="btn-secondary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
            >
              View Library
            </Link>
          }
          accent
        />
        <FeatureCard
          title="Playlist"
          status="Planned next"
          description="An ordered listen-later queue that can grow into a personal podcast feed with one episode per saved item."
          detail="Separate from Library: this is for sequencing what you want to hear next."
        />
        <FeatureCard
          title="Badges & streaks"
          status="Future garden"
          description="Progress markers, reading streaks, and gentle gamification for curiosity habits without turning the app into a casino."
          detail="Think milestones, continuity, and little rewards for coming back."
        />
      </section>
    </>
  );
};

const SignedInDashboard = () => {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { entries, isLoaded: areBookmarksLoaded } = useBookmarks();
  const personalPlaylist = usePersonalPlaylist();
  const {
    badges,
    badgeCredits,
    totalExp,
    unlockedBadgeCount,
    isLoaded: areBadgesLoaded,
  } = useBadges();
  const displayName = accountDisplayName(user);
  const email = user?.primaryEmailAddress?.emailAddress;
  const bookmarkCount = entries.length;
  const playlistCount = personalPlaylist.entries.length;
  const readyPlaylistCount = personalPlaylist.entries.filter(
    (entry) => entry.status === "ready",
  ).length;

  return (
    <>
      <SectionShell
        eyebrow="Dashboard"
        title={`Welcome back, ${isUserLoaded ? displayName : "friend"}`}
        description="This is your account hub: the place where synced reading, queued listening, and future progress features can live together without crowding the public browsing experience."
      >
        <div className="garden-bed pattern-leaves p-6 sm:p-7">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-3 py-1.5 text-accent">
              {librarySummary(bookmarkCount, areBookmarksLoaded)}
            </span>
            {email ? (
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-muted">
                Signed in as {email}
              </span>
            ) : null}
          </div>
        </div>
      </SectionShell>

      <section aria-label="Dashboard overview" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <DashboardSummaryCard
          eyebrow="Synced reading"
          title="Library"
          description="Your saved articles stay separate from the dashboard so the reading list can remain focused and roomy."
          detail={
            <>
              <span className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-3 py-1.5 text-accent">
                {librarySummary(bookmarkCount, areBookmarksLoaded)}
              </span>
            </>
          }
          action={
            <Link
              href="/library"
              className="btn-primary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
            >
              Open Library
            </Link>
          }
          accent
        />
        <DashboardSummaryCard
          eyebrow="Listen next"
          title="Playlist"
          description="Use the queue for article-to-podcast generation, then jump straight into the operational section below when you want to rearrange it."
          detail={
            <div className="flex flex-wrap gap-2.5">
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                {personalPlaylist.isLoaded
                  ? `${playlistCount} in queue`
                  : "Syncing queue"}
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                {personalPlaylist.isLoaded
                  ? `${readyPlaylistCount} ready episode${readyPlaylistCount === 1 ? "" : "s"}`
                  : "Checking feed"}
              </span>
              <span className="basis-full text-sm leading-[1.7] text-muted">
                {playlistSummary({
                  entryCount: playlistCount,
                  isAvailable: personalPlaylist.isAvailable,
                  isLoaded: personalPlaylist.isLoaded,
                  readyCount: readyPlaylistCount,
                })}
              </span>
            </div>
          }
          action={
            <a
              href="#playlist"
              className="btn-secondary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
            >
              Jump to Playlist
            </a>
          }
        />
        <DashboardSummaryCard
          eyebrow="Signed-in progress"
          title="Badges"
          description="Topic badges stay visible on the dashboard, but they get their own full-width section so the grid can breathe."
          detail={
            <div className="flex flex-wrap gap-2.5">
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                {areBadgesLoaded ? `${totalExp} EXP` : "Loading EXP"}
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                {areBadgesLoaded
                  ? `${unlockedBadgeCount} unlocked`
                  : "Loading badges"}
              </span>
              <span className="basis-full text-sm leading-[1.7] text-muted">
                {badgesSummary({
                  isLoaded: areBadgesLoaded,
                  totalExp,
                  unlockedBadgeCount,
                })}
              </span>
            </div>
          }
          action={
            <a
              href="#badges"
              className="btn-secondary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
            >
              Jump to Badges
            </a>
          }
        />
      </section>

      <section
        id="playlist"
        aria-labelledby="dashboard-playlist-heading"
        className="scroll-mt-20 pt-8"
      >
        <DashboardPlaylistCard
          entries={personalPlaylist.entries}
          feedUrl={personalPlaylist.feedUrl}
          isAvailable={personalPlaylist.isAvailable}
          isLoaded={personalPlaylist.isLoaded}
          moveDown={personalPlaylist.moveDown}
          moveUp={personalPlaylist.moveUp}
          remove={personalPlaylist.remove}
          retry={personalPlaylist.retry}
          headingId="dashboard-playlist-heading"
        />
      </section>

      <section
        id="badges"
        aria-labelledby="dashboard-badges-heading"
        className="scroll-mt-20 pt-8"
      >
        <DashboardBadgeCard
          badges={badges}
          badgeCredits={badgeCredits}
          totalExp={totalExp}
          unlockedBadgeCount={unlockedBadgeCount}
          isLoaded={areBadgesLoaded}
          headingId="dashboard-badges-heading"
        />
      </section>
    </>
  );
};

const LoadingDashboard = () => {
  return (
    <>
      <SectionShell
        eyebrow="Dashboard"
        title="Checking your account"
        description="Clerk and Convex are sorting out your session so we can show the right dashboard state."
      >
        <div className="garden-bed p-6" role="status" aria-busy="true">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-4 h-6 w-56" />
          <div className="skeleton mt-4 h-4 w-full max-w-2xl" />
        </div>
      </SectionShell>
    </>
  );
};

const LocalModeDashboard = () => {
  return (
    <>
      <SectionShell
        eyebrow="Local mode"
        title="Dashboard is only available with accounts enabled"
        description="This local browser-only mode keeps Curio Garden public and lightweight, so the account dashboard stays dormant here."
      >
        <div className="garden-bed p-6">
          <p className="text-sm leading-[1.8] text-foreground-2">
            You can still use the Library route for local bookmarks while working
            without Clerk or Convex auth.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/library"
              className="btn-secondary inline-flex min-h-11 items-center justify-center px-6 py-3 text-sm no-underline"
            >
              Open Library
            </Link>
            <Link
              href="/"
              className="btn-primary inline-flex min-h-11 items-center justify-center px-6 py-3 text-sm no-underline"
            >
              Back home
            </Link>
          </div>
        </div>
      </SectionShell>
    </>
  );
};

export const DashboardHub = () => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    analytics.dashboardPageAccessed();
  }, []);

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="mx-auto max-w-[88rem]">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={14}
              height={14}
              aria-hidden="true"
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        {isLocal ? (
          <LocalModeDashboard />
        ) : !isAuthLoaded ? (
          <LoadingDashboard />
        ) : !isSignedIn ? (
          <SignedOutDashboardTeaser />
        ) : (
          <SignedInDashboard />
        )}
      </div>
    </div>
  );
};
