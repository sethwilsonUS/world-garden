"use client";

import { useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { usePersonalPlaylist } from "@/hooks/usePersonalPlaylist";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const buttonClassName =
  "inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] border transition-all duration-200 disabled:cursor-not-allowed";

export const PlaylistActionButton = ({
  slug,
  title,
  className = "",
}: {
  slug: string;
  title: string;
  className?: string;
}) => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { addBySlug, isAdding, isAvailable, isLoaded, isInPlaylist } =
    usePersonalPlaylist();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLocal) {
    return null;
  }

  const disabled = isSubmitting || isAdding(slug);
  const active = isInPlaylist(slug);
  const isSyncPending = isSignedIn && !isAvailable;

  const content = (
    <>
      {active ? (
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
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : disabled ? (
        <svg
          className="animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          width={18}
          height={18}
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : isSyncPending ? (
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      ) : (
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
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 12h.01" />
          <path d="M3 6h.01" />
          <path d="M3 18h.01" />
        </svg>
      )}
    </>
  );

  if (!isAuthLoaded) {
    return (
      <button
        type="button"
        disabled
        aria-label="Checking playlist access"
        className={`${buttonClassName} border-border bg-surface text-muted ${className}`}
      >
        {content}
      </button>
    );
  }

  if (!isSignedIn) {
    return (
      <SignInButton>
        <button
          type="button"
          aria-label={`Sign in to add ${title} to your playlist`}
          title="Sign in to use your playlist"
          className={`${buttonClassName} border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground ${className}`}
        >
          {content}
        </button>
      </SignInButton>
    );
  }

  if (isSyncPending) {
    return (
      <button
        type="button"
        disabled
        aria-label={
          isLoaded
            ? `Playlist sync is still connecting for ${title}`
            : `Connecting playlist for ${title}`
        }
        title={
          isLoaded
            ? "Playlist sync is still connecting"
            : "Connecting playlist"
        }
        className={`${buttonClassName} border-border bg-surface text-muted ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={active || disabled}
      aria-label={
        active ? `${title} is already in your playlist` : `Add ${title} to your playlist`
      }
      title={active ? "Already in playlist" : "Add to playlist"}
      onClick={() => {
        setIsSubmitting(true);
        void addBySlug({ slug, title }).finally(() => setIsSubmitting(false));
      }}
      className={`${buttonClassName} ${
        active
          ? "border-accent-border bg-accent-bg text-accent"
          : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
      } ${className}`}
    >
      {content}
    </button>
  );
};
