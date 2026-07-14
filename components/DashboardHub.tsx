"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAuth, useUser } from "@clerk/nextjs";
import { DashboardBadgeCard } from "@/components/DashboardBadgeCard";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useBadges } from "@/hooks/useBadges";
import { usePersonalPlaylist } from "@/hooks/usePersonalPlaylist";
import { analytics } from "@/lib/analytics";
import {
  DashboardHubFrame,
  DashboardPlaylistCard,
  DashboardSummaryCard,
  LoadingDashboard,
  LocalModeDashboard,
  SectionShell,
  SignedOutDashboardTeaser,
} from "@/components/DashboardHubPresentation";

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

const DashboardAccountContent = () => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  if (!isAuthLoaded) return <LoadingDashboard />;
  if (!isSignedIn) return <SignedOutDashboardTeaser />;
  return <SignedInDashboard />;
};

export const DashboardHub = () => {
  useEffect(() => {
    analytics.dashboardPageAccessed();
  }, []);

  return (
    <DashboardHubFrame>
      {isLocal ? <LocalModeDashboard /> : <DashboardAccountContent />}
    </DashboardHubFrame>
  );
};
