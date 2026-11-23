"use client";

import Form from "next/form";
import { usePathname } from "next/navigation";

export type SearchFormVariant = "default" | "workbench" | "header";

const SearchIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

export const SearchForm = ({
  defaultValue = "",
  variant = "default",
  describedBy,
  inputId = "search-input",
  inputRef,
}: {
  defaultValue?: string;
  variant?: SearchFormVariant;
  describedBy?: string;
  inputId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) => {
  const isWorkbench = variant === "workbench";

  if (variant === "header") {
    return (
      <Form
        action="/search"
        role="search"
        aria-label="Site search"
        className="w-full"
      >
        <label htmlFor={inputId} className="sr-only">
          Search articles
        </label>
        <div className="search-bar flex min-h-11 items-stretch overflow-hidden rounded-xl border-2 border-control-border bg-surface transition-all duration-200">
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="search"
            placeholder="Search Wikipedia"
            defaultValue={defaultValue}
            autoComplete="off"
            required
            className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-[0.9375rem] text-foreground outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <button
            type="submit"
            aria-label="Search"
            className="flex min-h-10 min-w-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-foreground-2 transition-colors duration-200 hover:bg-surface-3 hover:text-foreground"
          >
            <SearchIcon size={18} />
          </button>
        </div>
      </Form>
    );
  }

  return (
    <Form
      action="/search"
      role="search"
      aria-label="Search Wikipedia articles"
      className="w-full"
    >
      <label htmlFor={inputId} className="sr-only">
        Search topic
      </label>

      <div
        className={`search-bar flex flex-wrap items-stretch overflow-hidden rounded-2xl border-2 border-accent-border bg-surface-2 transition-all duration-200 ${
          isWorkbench
            ? "bg-surface shadow-[0_6px_18px_var(--color-accent-glow)] sm:rounded-[18px]"
            : ""
        }`}
      >
        <div className="flex min-w-0 flex-[1_1_200px] items-stretch">
          <div
            className="flex shrink-0 items-center pl-[18px] pr-[4px] text-muted"
            aria-hidden="true"
          >
            <SearchIcon />
          </div>

          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="search"
            placeholder="Search any topic…"
            defaultValue={defaultValue}
            autoComplete="off"
            required
            aria-describedby={describedBy}
            className={`min-w-0 flex-1 border-0 bg-transparent px-[14px] py-[18px] text-[1.0625rem] text-foreground outline-none focus-visible:outline-none ${
              isWorkbench ? "sm:py-[20px] sm:text-lg" : ""
            }`}
          />
        </div>

        <button
          type="submit"
          className={`search-submit m-[6px] flex min-h-[44px] max-w-[calc(100%-12px)] flex-[0_1_auto] cursor-pointer flex-wrap items-center justify-center gap-[6px] break-words rounded-xl border-0 bg-btn-primary px-[24px] py-[12px] text-center text-[0.9375rem] font-semibold leading-snug text-btn-primary-text transition-all duration-200 [overflow-wrap:anywhere] ${
            isWorkbench ? "sm:rounded-[14px] sm:px-[30px] sm:text-base" : ""
          }`}
        >
          Search
        </button>
      </div>
    </Form>
  );
};

/** Routes that already lead with a large search field. */
export const isHeaderSearchHidden = (pathname: string) =>
  pathname === "/" || pathname === "/search";

/** Compact desktop header search (hidden where the page leads with search). */
export const HeaderSearch = () => {
  const pathname = usePathname();
  if (isHeaderSearchHidden(pathname)) return null;

  return (
    <div className="w-[min(17rem,24vw)] shrink">
      <SearchForm variant="header" inputId="header-search-input" />
    </div>
  );
};

export { SearchIcon };
