"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useBookmarks } from "@/hooks/useBookmarks";
import { analytics } from "@/lib/analytics";

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
        className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]"
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
  const displayName = accountDisplayName(user);
  const email = user?.primaryEmailAddress?.emailAddress;
  const bookmarkCount = entries.length;

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

      <section
        aria-label="Dashboard modules"
        className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <FeatureCard
          title="Library"
          status="Working now"
          description="Your synced reading list lives here. Save articles anywhere in the app and they will land in Library for easy return trips."
          detail={librarySummary(bookmarkCount, areBookmarksLoaded)}
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
        <FeatureCard
          title="Playlist"
          status="Coming soon"
          description="A deliberate, ordered queue for what you want to hear next, designed to grow into a personal podcast feed."
          detail="This will differ from Library by focusing on sequence and playback flow, not just saved status."
        />
        <FeatureCard
          title="Badges & streaks"
          status="Coming soon"
          description="A home for milestones, streaks, and other progress signals once we are ready to make curiosity a little more gameful."
          detail="The slot is ready. We are just waiting for the actual trophies to stop photosynthesizing."
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
  useEffect(() => {
    analytics.dashboardPageAccessed();
  }, []);

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-6xl mx-auto">
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
        ) : (
          <>
            <AuthLoading>
              <LoadingDashboard />
            </AuthLoading>
            <Unauthenticated>
              <SignedOutDashboardTeaser />
            </Unauthenticated>
            <Authenticated>
              <SignedInDashboard />
            </Authenticated>
          </>
        )}
      </div>
    </div>
  );
};
