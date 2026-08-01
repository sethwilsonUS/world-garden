"use client";

import { analytics } from "@/lib/analytics";
import { useBookmarks } from "@/hooks/useBookmarks";

export const BookmarkButton = ({
  slug,
  title,
  variant = "icon",
}: {
  slug: string;
  title: string;
  variant?: "icon" | "labeled";
}) => {
  const { isBookmarked, toggle } = useBookmarks();
  const saved = isBookmarked(slug);
  const label = saved ? "Saved to Library" : "Save to Library";

  return (
    <button
      type="button"
      onClick={() => {
        if (!saved) analytics.articleBookmarked();
        toggle(slug, title);
      }}
      aria-label={
        variant === "labeled"
          ? saved
            ? `Saved to Library: remove ${title}`
            : `Save to Library: ${title}`
          : saved
            ? `Remove ${title} from your Library`
            : `Save ${title} to your Library`
      }
      aria-pressed={saved}
      title={
        saved
          ? "Library: remove this saved article"
          : "Library: save this article to revisit later"
      }
      className={`linked-article-link inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] border transition-all duration-200 ${
        variant === "labeled" ? "px-3 py-2" : "h-11 w-11"
      } ${
        saved
          ? "border-accent-border bg-accent-bg text-accent"
          : "border-border bg-transparent text-muted"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
      </svg>
      {variant === "labeled" ? (
        <span className="text-sm font-medium">{label}</span>
      ) : null}
    </button>
  );
};
