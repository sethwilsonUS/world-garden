"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { useBookmarks } from "@/hooks/useBookmarks";
import type { BookmarkEntry } from "@/lib/bookmarks";

const CloseIcon = () => (
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
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

type BannerContent = {
  eyebrow: string;
  title: string;
  body: string;
  mobileBody: string;
  actions?: ReactNode;
};

const bannerLinkClass =
  "inline-flex min-h-8 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold no-underline";

const secondaryActionClass =
  "border border-border bg-surface-2 text-foreground-2 transition-colors duration-200 hover:border-accent-border hover:bg-surface-3 hover:text-foreground";

const BannerShell = ({
  eyebrow,
  title,
  body,
  mobileBody,
  actions,
  onDismiss,
}: BannerContent & {
  onDismiss: (trigger: HTMLButtonElement) => void;
}) => {
  return (
    <aside
      aria-label="Account notice"
      className="sticky top-12 z-40 border-b border-accent-border bg-surface-nav backdrop-blur-2xl"
    >
      <div className="container mx-auto flex flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 text-[0.8125rem] leading-5 sm:text-sm sm:leading-6">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-foreground-2">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent">
              {eyebrow}
            </span>
            <strong className="font-display text-sm font-semibold text-foreground sm:text-base">
              {title}
            </strong>
            <span className="md:hidden">{mobileBody}</span>
            <span className="hidden md:inline">{body}</span>
          </p>
        </div>

        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <div className="flex min-w-0 items-center gap-2">{actions}</div>
          <button
            type="button"
            onClick={(event) => onDismiss(event.currentTarget)}
            aria-label="Dismiss account notice"
            className="ml-auto flex size-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-muted transition-colors duration-200 hover:border-border hover:bg-surface-2 hover:text-foreground sm:ml-0"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </aside>
  );
};

const getAuthenticatedBannerContent = ({
  displayName,
  entries,
  isLoaded,
}: {
  displayName: string;
  entries: BookmarkEntry[];
  isLoaded: boolean;
}): BannerContent => {
  const savedSummary = !isLoaded
    ? "Syncing your saved articles."
    : entries.length === 0
      ? "Your Library is ready for its first saved article."
      : `${entries.length} saved article${entries.length === 1 ? "" : "s"} waiting in Library.`;

  return {
    eyebrow: "Signed in",
    title: `Welcome back, ${displayName}`,
    body: `${savedSummary} Dashboard has synced reading, playlists, and progress.`,
    mobileBody: `${savedSummary} Dashboard is ready.`,
    actions: (
      <>
        <Link
          href="/dashboard"
          className={`${bannerLinkClass} bg-btn-primary text-btn-primary-text transition-colors duration-200 hover:bg-btn-primary-hover`}
        >
          Dashboard
        </Link>
        <Link
          href="/library"
          className={`${bannerLinkClass} ${secondaryActionClass}`}
        >
          Library
        </Link>
      </>
    ),
  };
};

const SignedOutBannerContent = (): BannerContent => ({
  eyebrow: "Guest mode",
  title: "Browse now, sync later",
  body: "Curio Garden stays public without an account. Sign in for more natural article narration, synced bookmarks, your dashboard, and a personal playlist.",
  mobileBody:
    "Sign in for more natural article narration, bookmarks, and your playlist.",
  actions: (
    <>
      <SignInButton>
        <button
          type="button"
          className={`${bannerLinkClass} border-0 bg-btn-primary text-btn-primary-text transition-colors duration-200 hover:bg-btn-primary-hover`}
        >
          Sign in
        </button>
      </SignInButton>
      <Link
        href="/library"
        className={`${bannerLinkClass} ${secondaryActionClass}`}
      >
        Library
      </Link>
    </>
  ),
});

const LoadingBannerContent = (): BannerContent => ({
  eyebrow: "Account",
  title: "Checking session",
  body: "Account shortcuts will appear here when they are ready.",
  mobileBody: "Loading account shortcuts.",
});

const ConnectingBannerContent = (): BannerContent => ({
  eyebrow: "Account",
  title: "Connecting your account",
  body: "Your synced features are connecting. Article audio will use the standard article voice until your account is ready.",
  mobileBody: "Connecting synced features; standard article voice for now.",
});

const DegradedBannerContent = (): BannerContent => ({
  eyebrow: "Account",
  title: "Account connection paused",
  body: "Browsing still works. Synced bookmarks, playlists, and more natural article narration will be available when the account connection recovers.",
  mobileBody: "Browsing works; synced account features are reconnecting.",
});

export const HomeAuthStatusBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const { entries, isLoaded: bookmarksLoaded } = useBookmarks();
  const displayName =
    user?.firstName ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  if (dismissed) {
    return null;
  }

  const content = !isAuthLoaded
    ? LoadingBannerContent()
    : !isSignedIn
      ? SignedOutBannerContent()
      : isConvexAuthLoading
        ? ConnectingBannerContent()
        : isAuthenticated
          ? getAuthenticatedBannerContent({
              displayName,
              entries,
              isLoaded: bookmarksLoaded,
            })
          : DegradedBannerContent();

  const dismissBanner = (trigger: HTMLButtonElement) => {
    if (document.activeElement === trigger) {
      const focusTarget =
        document.getElementById("search-input") ??
        document.getElementById("main-content");
      focusTarget?.focus();
    }
    setDismissed(true);
  };

  return <BannerShell {...content} onDismiss={dismissBanner} />;
};
