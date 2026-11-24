"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import Form from "next/form";
import { usePathname, useRouter } from "next/navigation";
import { analytics } from "@/lib/analytics";
import { DataContext, type SearchSuggestion } from "@/lib/data-context";
import {
  formatWikipediaTypeaheadStatus,
  normalizeWikipediaSearchTerm,
} from "@/lib/wikipedia-search";

export type SearchFormVariant = "default" | "workbench" | "header";

const TYPEAHEAD_DEBOUNCE_MS = 220;
const TYPEAHEAD_MIN_LENGTH = 2;
const TYPEAHEAD_MAX_LENGTH = 200;
const MAX_LOCAL_SUGGESTION_CACHE = 64;
const EMPTY_SUGGESTIONS: SearchSuggestion[] = [];

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const assignRef = <T,>(ref: React.Ref<T> | undefined, value: T | null) => {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
};

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
  const isHeader = variant === "header";
  const dataContext = useContext(DataContext);
  const router = useRouter();

  const [query, setQuery] = useState(defaultValue);
  const [suggestionState, setSuggestionState] = useState<{
    term: string;
    items: SearchSuggestion[];
  }>({ term: "", items: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const suggestionsCacheRef = useRef(new Map<string, SearchSuggestion[]>());

  const normalizedQuery = normalizeWikipediaSearchTerm(query);
  const hasCurrentSuggestions =
    suggestionState.items.length > 0 &&
    suggestionState.term === normalizedQuery;
  const visibleSuggestions = useMemo(
    () => (hasCurrentSuggestions ? suggestionState.items : EMPTY_SUGGESTIONS),
    [hasCurrentSuggestions, suggestionState.items],
  );
  const effectiveOpen = isOpen && hasCurrentSuggestions;

  const listboxId = `${inputId}-suggestions`;
  const activeOptionId =
    effectiveOpen && activeIndex >= 0 && activeIndex < visibleSuggestions.length
      ? `${listboxId}-option-${activeIndex}`
      : undefined;

  const setCombinedInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      localInputRef.current = node;
      assignRef(inputRef, node);
    },
    [inputRef],
  );

  const cancelPendingTypeahead = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    requestSeqRef.current += 1;
  }, []);

  const closePopup = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingTypeahead();
    };
  }, [cancelPendingTypeahead]);

  useEffect(() => {
    if (!effectiveOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        cancelPendingTypeahead();
        closePopup();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [cancelPendingTypeahead, closePopup, effectiveOpen]);

  useEffect(() => {
    if (!effectiveOpen || activeIndex < 0) return;
    const option = optionRefs.current[activeIndex];
    if (option && typeof option.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, effectiveOpen]);

  const navigateToSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      cancelPendingTypeahead();
      setQuery(suggestion.title);
      setSuggestionState({ term: "", items: [] });
      setIsOpen(false);
      setActiveIndex(-1);
      setLiveAnnouncement("");
      analytics.searchResultClicked();
      router.push(`/article/${encodeURIComponent(suggestion.key)}`);
    },
    [cancelPendingTypeahead, router],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setQuery(nextValue);
      cancelPendingTypeahead();

      const normalized = normalizeWikipediaSearchTerm(nextValue);
      if (
        normalized.length < TYPEAHEAD_MIN_LENGTH ||
        normalized.length > TYPEAHEAD_MAX_LENGTH ||
        !dataContext?.suggestTitles
      ) {
        setSuggestionState({ term: "", items: [] });
        setIsOpen(false);
        setActiveIndex(-1);
        setLiveAnnouncement("");
        return;
      }

      const cacheKey = normalized.toLocaleLowerCase("en-US");
      const cached = suggestionsCacheRef.current.get(cacheKey);
      if (cached) {
        setSuggestionState({ term: normalized, items: cached });
        setActiveIndex(-1);
        setIsOpen(cached.length > 0);
        setLiveAnnouncement(
          formatWikipediaTypeaheadStatus(normalized, cached.length),
        );
        return;
      }

      // Clear stale suggestions immediately so previous-query options cannot
      // remain highlighted or clickable while the new query is debouncing.
      setSuggestionState({ term: "", items: [] });
      setIsOpen(false);
      setActiveIndex(-1);
      setLiveAnnouncement("");

      const requestSeq = requestSeqRef.current;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        void dataContext
          .suggestTitles({ term: normalized, signal: controller.signal })
          .then((nextSuggestions) => {
            if (
              controller.signal.aborted ||
              requestSeqRef.current !== requestSeq
            ) {
              return;
            }
            abortControllerRef.current = null;

            const cache = suggestionsCacheRef.current;
            cache.set(cacheKey, nextSuggestions);
            if (cache.size > MAX_LOCAL_SUGGESTION_CACHE) {
              const oldestKey = cache.keys().next().value as string | undefined;
              if (oldestKey && oldestKey !== cacheKey) {
                cache.delete(oldestKey);
              }
            }

            setSuggestionState({ term: normalized, items: nextSuggestions });
            setActiveIndex(-1);
            setIsOpen(nextSuggestions.length > 0);
            setLiveAnnouncement(
              formatWikipediaTypeaheadStatus(
                normalized,
                nextSuggestions.length,
              ),
            );
          })
          .catch((error: unknown) => {
            if (
              controller.signal.aborted ||
              requestSeqRef.current !== requestSeq ||
              isAbortError(error)
            ) {
              return;
            }
            abortControllerRef.current = null;
            setSuggestionState({ term: "", items: [] });
            setIsOpen(false);
            setActiveIndex(-1);
            setLiveAnnouncement("");
          });
      }, TYPEAHEAD_DEBOUNCE_MS);
    },
    [cancelPendingTypeahead, dataContext],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }

      if (event.key === "ArrowDown") {
        if (!hasCurrentSuggestions) return;
        event.preventDefault();
        if (!effectiveOpen) {
          setIsOpen(true);
          setActiveIndex(0);
        } else {
          setActiveIndex((prev) => (prev + 1) % visibleSuggestions.length);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        if (!hasCurrentSuggestions) return;
        event.preventDefault();
        if (!effectiveOpen) {
          setIsOpen(true);
          setActiveIndex(visibleSuggestions.length - 1);
        } else {
          setActiveIndex((prev) =>
            prev <= 0 ? visibleSuggestions.length - 1 : prev - 1,
          );
        }
        return;
      }

      if (event.key === "Escape") {
        cancelPendingTypeahead();
        if (effectiveOpen) {
          event.preventDefault();
          closePopup();
        }
        return;
      }

      if (event.key === "Tab") {
        cancelPendingTypeahead();
        if (effectiveOpen) {
          closePopup();
        }
        return;
      }

      if (event.key === "Enter") {
        if (
          hasCurrentSuggestions &&
          effectiveOpen &&
          activeIndex >= 0 &&
          visibleSuggestions[activeIndex]
        ) {
          event.preventDefault();
          navigateToSuggestion(visibleSuggestions[activeIndex]);
          return;
        }
        cancelPendingTypeahead();
        closePopup();
        setLiveAnnouncement("");
      }
    },
    [
      activeIndex,
      cancelPendingTypeahead,
      closePopup,
      effectiveOpen,
      hasCurrentSuggestions,
      navigateToSuggestion,
      visibleSuggestions,
    ],
  );

  const handleContainerBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        !containerRef.current ||
        !(nextTarget instanceof Node) ||
        !containerRef.current.contains(nextTarget)
      ) {
        cancelPendingTypeahead();
        closePopup();
      }
    },
    [cancelPendingTypeahead, closePopup],
  );

  const handleSubmit = useCallback(() => {
    cancelPendingTypeahead();
    closePopup();
    setLiveAnnouncement("");
  }, [cancelPendingTypeahead, closePopup]);

  const suggestionsListbox = (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Suggested Wikipedia articles"
        hidden={!effectiveOpen}
        className={`absolute left-0 right-0 top-full mt-1.5 m-0 list-none max-h-[min(24rem,65svh)] overflow-y-auto overscroll-contain border-2 border-accent-border bg-surface-2 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.16)] ${
          isHeader ? "z-50 rounded-xl" : "z-40 rounded-2xl"
        }`}
      >
        {visibleSuggestions.map((suggestion, index) => {
          const isActive = index === activeIndex;
          return (
            <li
              key={suggestion.wikiPageId}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={isActive}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => navigateToSuggestion(suggestion)}
              className={`flex min-h-[44px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-100 ${
                isActive
                  ? "bg-surface-3 ring-2 ring-accent"
                  : "hover:bg-surface-3"
              }`}
            >
              {suggestion.thumbnail ? (
                <span
                  aria-hidden="true"
                  className="h-[40px] w-[40px] shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={suggestion.thumbnail.source}
                    alt=""
                    aria-hidden="true"
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span
                  className={`block break-words [overflow-wrap:anywhere] font-display font-semibold leading-snug text-foreground ${
                    isHeader ? "text-sm" : "text-sm sm:text-base"
                  }`}
                >
                  {suggestion.title}
                </span>
                {suggestion.description ? (
                  <>
                    <span className="sr-only"> — </span>
                    <span
                      className={`mt-0.5 block break-words [overflow-wrap:anywhere] leading-snug text-muted ${
                        isHeader ? "text-xs" : "text-xs sm:text-sm"
                      }`}
                    >
                      {suggestion.description}
                    </span>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );

  if (isHeader) {
    return (
      <Form
        action="/search"
        role="search"
        aria-label="Site search"
        className="w-full"
        onSubmit={handleSubmit}
      >
        <label htmlFor={inputId} className="sr-only">
          Search articles
        </label>
        <div
          ref={containerRef}
          className="relative w-full"
          onBlur={handleContainerBlur}
        >
          <div className="search-bar flex min-h-11 items-stretch overflow-hidden rounded-xl border-2 border-control-border bg-surface transition-all duration-200">
            <input
              ref={setCombinedInputRef}
              id={inputId}
              name="q"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={effectiveOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              placeholder="Search Wikipedia"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
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
          {suggestionsListbox}
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
      onSubmit={handleSubmit}
    >
      <label htmlFor={inputId} className="sr-only">
        Search topic
      </label>

      <div
        ref={containerRef}
        className="relative w-full"
        onBlur={handleContainerBlur}
      >
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
              ref={setCombinedInputRef}
              id={inputId}
              name="q"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={effectiveOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              placeholder="Search any topic…"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
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
        {suggestionsListbox}
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
