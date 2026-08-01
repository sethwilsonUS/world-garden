"use client";

import { useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { usePersonalPlaylist } from "@/hooks/usePersonalPlaylist";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const buttonClassName = (variant: "icon" | "labeled") =>
  `inline-flex min-h-[44px] cursor-pointer flex-wrap items-center justify-center gap-[8px] rounded-[10px] border text-center leading-snug transition-all duration-200 disabled:cursor-not-allowed ${
    variant === "labeled"
      ? "max-w-full px-[12px] py-[8px]"
      : "h-[44px] w-[44px] shrink-0"
  }`;

export const PlaylistActionButton = ({
  slug,
  title,
  className = "",
  variant = "icon",
}: {
  slug: string;
  title: string;
  className?: string;
  variant?: "icon" | "labeled";
}) => {
  if (isLocal) {
    return null;
  }

  return (
    <PlaylistActionButtonInner
      slug={slug}
      title={title}
      className={className}
      variant={variant}
    />
  );
};

const PlaylistActionButtonInner = ({
  slug,
  title,
  className = "",
  variant,
}: {
  slug: string;
  title: string;
  className?: string;
  variant: "icon" | "labeled";
}) => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { addBySlug, isAdding, isAvailable, isLoaded, isInPlaylist } =
    usePersonalPlaylist();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const disabled = isSubmitting || isAdding(slug);
  const active = isInPlaylist(slug);
  const isSyncPending = isSignedIn && !isAvailable;
  const visibleLabel = !isAuthLoaded
    ? "Checking…"
    : active
      ? "In Playlist"
      : disabled
        ? "Adding…"
        : isSyncPending
          ? "Connecting…"
          : "Add to Playlist";
  const accessibleName = (description: string) =>
    variant === "labeled" ? `${visibleLabel}: ${description}` : description;

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
      {variant === "labeled" ? (
        <span className="text-sm font-medium">{visibleLabel}</span>
      ) : null}
    </>
  );

  if (!isAuthLoaded) {
    return (
      <button
        type="button"
        disabled
        aria-label={accessibleName("checking playlist access")}
        className={`${buttonClassName(variant)} border-border bg-surface text-muted ${className}`}
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
          aria-label={accessibleName(
            `sign in to add ${title} and generate a podcast episode`,
          )}
          title="Playlist: sign in to generate a podcast episode"
          className={`${buttonClassName(variant)} border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground ${className}`}
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
        aria-label={accessibleName(
          isLoaded
            ? `Playlist sync is still connecting for ${title}`
            : `connecting Playlist for ${title}`,
        )}
        title={
          isLoaded ? "Playlist sync is still connecting" : "Connecting playlist"
        }
        className={`${buttonClassName(variant)} border-border bg-surface text-muted ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={active || disabled}
      aria-label={accessibleName(
        active
          ? `${title} is already in your Playlist`
          : `${title}. Generates a podcast episode for your private feed`,
      )}
      title={
        active
          ? "Playlist: podcast episode already queued"
          : "Playlist: generate a podcast episode for your private feed"
      }
      onClick={() => {
        setIsSubmitting(true);
        void addBySlug({ slug, title }).finally(() => setIsSubmitting(false));
      }}
      className={`${buttonClassName(variant)} ${
        active
          ? "border-accent-border bg-accent-bg text-accent"
          : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
      } ${className}`}
    >
      {content}
    </button>
  );
};
