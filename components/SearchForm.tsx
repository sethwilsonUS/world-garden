"use client";

import { useRouter } from "next/navigation";
import { analytics } from "@/lib/analytics";

export const SearchForm = ({
  defaultValue = "",
  autoFocus = false,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
}) => {
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const term = String(new FormData(form).get("q") ?? "").trim();
    if (term) {
      analytics.search(term);
      router.push(`/search?q=${encodeURIComponent(term)}`);
    }
  };

  return (
    <form
      method="GET"
      action="/search"
      role="search"
      aria-label="Search Wikipedia articles"
      className="w-full"
      onSubmit={handleSubmit}
    >
      <label htmlFor="search-input" className="sr-only">
        Search topic
      </label>

      <div
        className="search-bar flex items-center bg-surface-2 border-2 border-accent-border rounded-2xl transition-all duration-200 overflow-hidden"
      >
        <div
          className="flex items-center pl-[18px] pr-1 text-muted shrink-0"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={20}
            height={20}
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <input
          id="search-input"
          name="q"
          type="search"
          placeholder="Monarch butterfly, Ada Lovelace, Bossa nova..."
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          autoComplete="off"
          required
          className="flex-1 min-w-0 py-[18px] px-4 bg-transparent border-0 outline-none focus-visible:outline-none text-[1.0625rem] text-foreground"
        />

        <button
          type="submit"
          className="search-submit flex items-center gap-1.5 py-3 px-6 m-1.5 bg-btn-primary text-btn-primary-text border-0 rounded-xl font-semibold text-[0.9375rem] cursor-pointer whitespace-nowrap shrink-0 transition-all duration-200"
        >
          Search
        </button>
      </div>
    </form>
  );
};
