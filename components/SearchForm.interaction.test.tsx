// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type DataContextValue,
  type SearchSuggestion,
} from "@/lib/data-context";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next/form", () => ({
  default: ({
    children,
    action,
    ...rest
  }: React.FormHTMLAttributes<HTMLFormElement> & { action?: string }) => (
    <form action={action} {...rest}>
      {children}
    </form>
  ),
}));

const { SearchForm } = await import("./SearchForm");

const createDataValue = (
  suggestTitles: DataContextValue["suggestTitles"],
): DataContextValue => ({
  search: async () => [],
  suggestTitles,
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
  getRelatedArticles: async () => [],
});

const SAMPLE_SUGGESTIONS: SearchSuggestion[] = [
  {
    wikiPageId: "974",
    key: "Ada_Lovelace",
    title: "Ada Lovelace",
    description: "English mathematician and writer",
    thumbnail: {
      source: "https://thumb.wikimedia.org/thumb/ada.jpg/60px-ada.jpg",
      width: 60,
      height: 75,
    },
  },
  {
    wikiPageId: "1271",
    key: "Analytical_engine",
    title: "Analytical engine",
    description: "Proposed mechanical general-purpose computer",
  },
];

const setInputValue = (input: HTMLInputElement, value: string) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("SearchForm typeahead combobox", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    pushMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces, cancels stale fetches, renders decorative thumbnails, and supports keyboard navigation", async () => {
    const signals: AbortSignal[] = [];
    const suggestTitles = vi.fn(
      ({ term, signal }: { term: string; signal?: AbortSignal }) => {
        if (signal) signals.push(signal);
        if (term === "Ada") {
          return new Promise<SearchSuggestion[]>(() => {
            // Never resolves so the next keystroke aborts it.
          });
        }
        return Promise.resolve(SAMPLE_SUGGESTIONS);
      },
    );

    await act(async () => {
      root.render(
        <DataContext.Provider value={createDataValue(suggestTitles)}>
          <SearchForm />
        </DataContext.Provider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    )!;
    const listbox = container.querySelector<HTMLUListElement>(
      'ul[role="listbox"]',
    )!;
    const status = container.querySelector<HTMLDivElement>(
      'div[role="status"][aria-live="polite"][aria-atomic="true"]',
    )!;

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.hidden).toBe(true);
    expect(status.textContent).toBe("");

    // Single character should not trigger typeahead.
    await act(async () => {
      setInputValue(input, "A");
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(suggestTitles).not.toHaveBeenCalled();

    // First multi-character query fires after debounce.
    await act(async () => {
      setInputValue(input, "Ada");
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(suggestTitles).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    // Further typing immediately aborts the prior in-flight request.
    await act(async () => {
      setInputValue(input, "Ada Lov");
    });
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });

    expect(suggestTitles).toHaveBeenCalledTimes(2);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(listbox.hidden).toBe(false);
    expect(status.textContent).toBe(
      "2 suggestions available for Ada Lov. Use up and down arrow keys to choose, or press Enter to search.",
    );

    const options = Array.from(
      listbox.querySelectorAll<HTMLLIElement>('li[role="option"]'),
    );
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("Ada Lovelace");
    expect(options[0]?.textContent).toContain(
      "English mathematician and writer",
    );

    // Decorative thumbnail must have empty alt and aria-hidden.
    const img = options[0]?.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(options[1]?.querySelector("img")).toBeNull();

    // ArrowDown highlights first option via aria-activedescendant.
    input.focus();
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    // ArrowDown moves to second option.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    // Escape closes popup while keeping focus in input and preserving typed query.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(listbox.hidden).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Ada Lov");

    // ArrowDown re-opens cached suggestions and Enter navigates directly to article.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/article/Ada_Lovelace");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("allows Enter to submit full search when no option is highlighted and closes cleanly on Tab", async () => {
    const suggestTitles = vi.fn(async () => SAMPLE_SUGGESTIONS);

    await act(async () => {
      root.render(
        <DataContext.Provider value={createDataValue(suggestTitles)}>
          <SearchForm />
        </DataContext.Provider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    )!;
    await act(async () => {
      setInputValue(input, "Ada");
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(input.getAttribute("aria-expanded")).toBe("true");

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(enterEvent);
    });
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("false");

    // Reopen then press Tab: closes without trapping focus.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(input.getAttribute("aria-expanded")).toBe("true");

    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(tabEvent);
    });
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("announces empty suggestions and fails silently when typeahead errors", async () => {
    const suggestTitles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Upstream 503"));

    await act(async () => {
      root.render(
        <DataContext.Provider value={createDataValue(suggestTitles)}>
          <SearchForm />
        </DataContext.Provider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    )!;
    const status = container.querySelector<HTMLDivElement>(
      'div[role="status"][aria-live="polite"][aria-atomic="true"]',
    )!;

    await act(async () => {
      setInputValue(input, "Zzzq");
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(status.textContent).toBe(
      "No instant suggestions for Zzzq. Press Enter to run a full search.",
    );

    await act(async () => {
      setInputValue(input, "ErrorQuery");
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(status.textContent).toBe("");
    expect(input.value).toBe("ErrorQuery");
  });
});
