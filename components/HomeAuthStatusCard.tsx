"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useBookmarks } from "@/hooks/useBookmarks";

const CardShell = ({
  eyebrow,
  title,
  statusTone = "text-accent",
  children,
}: {
  eyebrow: string;
  title: string;
  statusTone?: string;
  children: ReactNode;
}) => {
  return (
    <section
      aria-labelledby="auth-status-heading"
      className="garden-bed pattern-leaves overflow-hidden px-6 py-5 text-left"
    >
      <p className={`text-[0.7rem] font-semibold uppercase tracking-[0.14em] ${statusTone}`}>
        {eyebrow}
      </p>
      <h2
        id="auth-status-heading"
        className="font-display text-xl font-semibold text-foreground mt-2"
      >
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
};

const AuthenticatedViewerState = () => {
  const { user } = useUser();
  const { entries, isLoaded } = useBookmarks();
  const displayName =
    user?.firstName ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";
  const savedSummary = !isLoaded
    ? "Syncing your saved articles."
    : entries.length === 0
      ? "Your synced Library is ready for its first article."
      : `${entries.length} saved article${entries.length === 1 ? "" : "s"} waiting in Library.`;

  return (
    <CardShell eyebrow="Signed in" title={`Welcome back, ${displayName}`}>
      <p className="text-sm leading-6 text-foreground-2">
        Your account is ready. {savedSummary} Dashboard is the new home for
        synced reading now, with playlists and progress features planted for a
        later season.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="btn-primary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
        >
          Open Dashboard
        </Link>
        <Link
          href="/library"
          className="btn-secondary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
        >
          Open Library
        </Link>
      </div>
    </CardShell>
  );
};

export const HomeAuthStatusCard = () => {
  return (
    <div aria-live="polite">
      <AuthLoading>
        <CardShell
          eyebrow="Checking session"
          title="Looking for a Convex session"
        >
          <p className="text-sm leading-6 text-foreground-2">
            Checking whether to show your guest view or account dashboard.
          </p>
        </CardShell>
      </AuthLoading>

      <Unauthenticated>
        <CardShell
          eyebrow="Guest mode"
          title="Browse now, sync later"
        >
          <p className="text-sm leading-6 text-foreground-2">
            Curio Garden stays public without an account. New here? Continue
            with Google or create an email account in the sign-in flow when you
            want synced bookmarks and a dashboard for future features.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <SignInButton>
              <button className="btn-primary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm">
                Sign in
              </button>
            </SignInButton>
            <Link
              href="/library"
              className="btn-secondary inline-flex min-h-10 items-center justify-center px-5 py-2.5 text-sm no-underline"
            >
              Open Library
            </Link>
          </div>
        </CardShell>
      </Unauthenticated>

      <Authenticated>
        <AuthenticatedViewerState />
      </Authenticated>
    </div>
  );
};
