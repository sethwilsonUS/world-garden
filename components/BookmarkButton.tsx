"use client";

import { useBookmarks } from "@/hooks/useBookmarks";

export const BookmarkButton = ({ slug, title }: { slug: string; title: string }) => {
  const { isBookmarked, toggle } = useBookmarks();
  const saved = isBookmarked(slug);

  return (
    <button
      onClick={() => toggle(slug, title)}
      aria-label={saved ? `Remove ${title} from reading list` : `Save ${title} to reading list`}
      aria-pressed={saved}
      title={saved ? "Remove from reading list" : "Save for later"}
      className={`linked-article-link inline-flex items-center justify-center w-10 h-10 mt-1 shrink-0 rounded-[10px] cursor-pointer transition-all duration-200 border ${saved ? "bg-accent-bg border-accent-border text-accent" : "bg-transparent border-border text-muted"}`}
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
    </button>
  );
};
