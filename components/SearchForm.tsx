"use client";

export const SearchForm = ({
  defaultValue = "",
  variant = "default",
}: {
  defaultValue?: string;
  variant?: "default" | "workbench";
}) => {
  const isWorkbench = variant === "workbench";

  return (
    <form
      method="GET"
      action="/search"
      role="search"
      aria-label="Search Wikipedia articles"
      className="w-full"
    >
      <label htmlFor="search-input" className="sr-only">
        Search topic
      </label>

      <div
        className={`search-bar flex items-center overflow-hidden rounded-2xl border-2 border-accent-border bg-surface-2 transition-all duration-200 ${
          isWorkbench
            ? "lg:rounded-[18px] lg:bg-surface lg:shadow-[0_5px_14px_var(--color-accent-glow)]"
            : ""
        }`}
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
          autoComplete="off"
          required
          className={`min-w-0 flex-1 border-0 bg-transparent px-4 py-[18px] text-[1.0625rem] text-foreground outline-none focus-visible:outline-none ${
            isWorkbench ? "lg:py-[21px]" : ""
          }`}
        />

        <button
          type="submit"
          className={`search-submit m-1.5 flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border-0 bg-btn-primary px-6 py-3 text-[0.9375rem] font-semibold text-btn-primary-text transition-all duration-200 ${
            isWorkbench ? "lg:rounded-[14px] lg:px-8 lg:py-4" : ""
          }`}
        >
          Search
        </button>
      </div>
    </form>
  );
};
