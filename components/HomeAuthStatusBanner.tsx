"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { useBookmarks } from "@/hooks/useBookmarks";
import type { BookmarkEntry } from "@/lib/bookmarks";

/**
 * A quiet, one-line account note under the home search field. It replaces
 * the old full-width banner so the page leads with search, and dismissal is
 * remembered per note kind (dismissing the guest note does not hide the
 * signed-in welcome after a later sign-in).
 */

export const ACCOUNT_NOTE_DISMISSED_KEY = "curio-home-account-note-dismissed";
const DISMISS_EVENT = "curio:account-note-dismissed";

type NoteKind = "guest" | "member" | "status";

type NoteContent = {
  kind: NoteKind;
  title: string;
  body: string;
  action?: ReactNode;
};

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

// Inline in a sentence (exempt from target-size minimums), padded for comfort.
const inlineActionClass =
  "inline cursor-pointer rounded border-0 bg-transparent p-0 px-1 align-baseline font-[inherit] leading-[inherit] font-semibold text-accent underline decoration-accent/60 underline-offset-[3px] hover:text-accent-hover";

const readDismissed = (): string => {
  try {
    return window.localStorage.getItem(ACCOUNT_NOTE_DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
};

const useDismissedKinds = () =>
  useSyncExternalStore(subscribe, readDismissed, () => "");

const getMemberContent = ({
  displayName,
  entries,
  isLoaded,
}: {
  displayName: string;
  entries: BookmarkEntry[];
  isLoaded: boolean;
}): NoteContent => {
  const savedSummary = !isLoaded
    ? "Syncing your saved articles."
    : entries.length === 0
      ? "Your Library is ready for its first saved article."
      : `${entries.length} saved article${entries.length === 1 ? "" : "s"} waiting in Library.`;

  return {
    kind: "member",
    title: `Welcome back, ${displayName}.`,
    body: savedSummary,
    action: (
      <Link href="/dashboard" className={inlineActionClass}>
        Open Dashboard
      </Link>
    ),
  };
};

const guestContent = (): NoteContent => ({
  kind: "guest",
  title: "No account needed.",
  body: "Sign in for more natural narration, a synced Library, and your personal podcast playlist.",
  action: (
    <SignInButton>
      <button type="button" className={inlineActionClass}>
        Sign in
      </button>
    </SignInButton>
  ),
});

const connectingContent = (): NoteContent => ({
  kind: "status",
  title: "Connecting your account.",
  body: "Article audio uses the standard article voice until your account is ready.",
});

const degradedContent = (): NoteContent => ({
  kind: "status",
  title: "Account connection paused.",
  body: "Browsing still works. Synced bookmarks, playlists, and more natural narration return when the connection recovers.",
});

export const HomeAuthStatusBanner = () => {
  const dismissedKinds = useDismissedKinds();
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const { entries, isLoaded: bookmarksLoaded } = useBookmarks();
  const displayName =
    user?.firstName ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  const content: NoteContent | null = !isAuthLoaded
    ? null
    : !isSignedIn
      ? guestContent()
      : isConvexAuthLoading
        ? connectingContent()
        : isAuthenticated
          ? getMemberContent({
              displayName,
              entries,
              isLoaded: bookmarksLoaded,
            })
          : degradedContent();

  const dismiss = useCallback(
    (trigger: HTMLButtonElement, kind: NoteKind) => {
      if (document.activeElement === trigger) {
        const focusTarget =
          document.getElementById("search-input") ??
          document.getElementById("main-content");
        focusTarget?.focus();
      }
      try {
        const kinds = new Set(readDismissed().split(",").filter(Boolean));
        kinds.add(kind);
        window.localStorage.setItem(
          ACCOUNT_NOTE_DISMISSED_KEY,
          [...kinds].join(","),
        );
      } catch {
        // Storage can be unavailable (private mode); fall through to the
        // event so this page view still hides the note.
      }
      window.dispatchEvent(new Event(DISMISS_EVENT));
    },
    [],
  );

  const isDismissed =
    content !== null &&
    content.kind !== "status" &&
    dismissedKinds.split(",").includes(content.kind);

  // Reserve the row's height while auth resolves to avoid layout shift.
  if (!content || isDismissed) {
    return <div className="mt-5 min-h-11" data-home-account-note="" />;
  }

  return (
    <aside
      aria-label="Account"
      data-home-account-note=""
      className="mx-auto mt-5 flex max-w-xl items-start justify-center gap-1 text-[0.9375rem] leading-[1.6] text-foreground-2"
    >
      <div className="m-0 min-w-0 py-2.5 text-center">
        <strong className="font-semibold text-foreground">
          {content.title}
        </strong>{" "}
        {content.body} {content.action}
      </div>
      {content.kind !== "status" ? (
        <button
          type="button"
          onClick={(event) => dismiss(event.currentTarget, content.kind)}
          aria-label="Dismiss account note"
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground"
        >
          <CloseIcon />
        </button>
      ) : null}
    </aside>
  );
};
