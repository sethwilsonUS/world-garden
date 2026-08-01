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
        className={`search-bar flex flex-wrap items-stretch overflow-hidden rounded-2xl border-2 border-accent-border bg-surface-2 transition-all duration-200 ${
          isWorkbench
            ? "lg:rounded-[18px] lg:bg-surface lg:shadow-[0_5px_14px_var(--color-accent-glow)]"
            : ""
        }`}
      >
        <div className="flex min-w-0 flex-[1_1_224px] items-stretch">
          <div
            className="flex shrink-0 items-center pl-[18px] pr-[4px] text-muted"
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
            className={`min-w-0 flex-1 border-0 bg-transparent px-[16px] py-[18px] text-[1.0625rem] text-foreground outline-none focus-visible:outline-none ${
              isWorkbench ? "lg:py-[21px]" : ""
            }`}
          />
        </div>

        <button
          type="submit"
          className={`search-submit m-[6px] flex min-h-[44px] max-w-[calc(100%-12px)] flex-[0_1_auto] cursor-pointer flex-wrap items-center justify-center gap-[6px] break-words rounded-xl border-0 bg-btn-primary px-[24px] py-[12px] text-center text-[0.9375rem] font-semibold leading-snug text-btn-primary-text transition-all duration-200 [overflow-wrap:anywhere] ${
            isWorkbench ? "lg:rounded-[14px] lg:px-[32px] lg:py-[16px]" : ""
          }`}
        >
          Search
        </button>
      </div>
    </form>
  );
};
