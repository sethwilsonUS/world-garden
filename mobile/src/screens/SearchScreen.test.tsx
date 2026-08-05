import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import type { WikipediaSearchResult } from "@curio-garden/domain";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { SearchScreen } from "./SearchScreen";

const mockSearch = jest.fn<
  Promise<WikipediaSearchResult[]>,
  [{ term: string }]
>();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);

function usePlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: os,
  });
}

jest.mock("../data/WikipediaReaderContext", () => ({
  useWikipediaReader: () => ({ search: mockSearch }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: mockCanGoBack,
    push: mockPush,
    replace: mockReplace,
  }),
}));

const result = (
  wikiPageId: string,
  title: string,
  description = `${title} description`,
): WikipediaSearchResult => ({
  wikiPageId,
  title,
  description,
  url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderSearch(term: string, focusHeading?: jest.Mock) {
  return render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <SearchScreen focusHeading={focusHeading} term={term} />
    </GardenThemeProvider>,
  );
}

describe("SearchScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalPlatformDescriptor) {
      Object.defineProperty(Platform, "OS", originalPlatformDescriptor);
    }
  });

  it("renders the empty search state without starting a request", () => {
    renderSearch("   ");

    expect(
      screen.getByRole("header", { name: "Search Wikipedia" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Plant a seed")).toBeOnTheScreen();
    expect(
      screen.getByText("Enter a topic above to search Wikipedia."),
    ).toBeOnTheScreen();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("keeps one polite status node while moving from searching to results", async () => {
    const request = deferred<WikipediaSearchResult[]>();
    mockSearch.mockReturnValue(request.promise);
    renderSearch("Moria");

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith({ term: "Moria" });
      expect(
        screen.getByText("Searching Wikipedia for Moria."),
      ).toBeOnTheScreen();
    });
    const status = screen.getByTestId("search-status");

    await act(async () => {
      request.resolve([result("1", "Moria"), result("2", "Mines of Moria")]);
      await request.promise;
    });

    await waitFor(() => {
      expect(
        screen.getByText("2 search results found for Moria."),
      ).toBeOnTheScreen();
    });
    expect(screen.getByTestId("search-status")).toBe(status);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("Refine your search")).toBeOnTheScreen();
  });

  it("shows a safe retryable error without exposing backend details", async () => {
    const announce = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    mockSearch.mockRejectedValueOnce(
      new Error("upstream token=secret infrastructure details"),
    );
    renderSearch("Silmarils");

    expect(
      await screen.findByRole("alert", { name: /Search failed/i }),
    ).toHaveAccessibleName(
      "Search failed. Check your connection and try again.",
    );
    expect(screen.queryByText(/token=secret/i)).not.toBeOnTheScreen();
    expect(
      announce.mock.calls.filter(
        ([message]) =>
          message === "Search failed. Check your connection and try again.",
      ),
    ).toHaveLength(1);

    mockSearch.mockResolvedValueOnce([result("3", "Silmaril")]);
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("link", { name: /Silmaril/ })).toBeOnTheScreen();
    });

    announce.mockRestore();
  });

  it("uses exactly one active Android live region for a search error", async () => {
    usePlatform("android");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    mockSearch.mockRejectedValueOnce(new Error("offline"));

    renderSearch("Silmarils");

    expect(
      await screen.findByRole("alert", { name: /Search failed/i }),
    ).toHaveProp("accessibilityLiveRegion", "polite");
    expect(screen.getByTestId("search-status")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(screen.getByTestId("wikipedia-search-error")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(announce).not.toHaveBeenCalled();
    expect(announceWithOptions).not.toHaveBeenCalled();

    announce.mockRestore();
    announceWithOptions.mockRestore();
  });

  it("renders the current empty-result copy and announcement", async () => {
    mockSearch.mockResolvedValueOnce([]);
    renderSearch("Entwives");

    expect(await screen.findByText("No seeds found")).toBeOnTheScreen();
    expect(
      screen.getByText("No search results found for Entwives."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Try searching for a different topic."),
    ).toBeOnTheScreen();
  });

  it("ignores stale requests when the route term changes", async () => {
    const announce = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const first = deferred<WikipediaSearchResult[]>();
    const second = deferred<WikipediaSearchResult[]>();
    mockSearch.mockImplementation(({ term }) =>
      term === "Moria" ? first.promise : second.promise,
    );
    const view = renderSearch("Moria");

    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <SearchScreen term="The Shire" />
      </GardenThemeProvider>,
    );
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve([result("1", "Moria")]);
      await first.promise;
    });
    expect(
      screen.queryByText("Moria description", {
        includeHiddenElements: true,
      }),
    ).not.toBeOnTheScreen();
    expect(
      announce.mock.calls.some(
        ([message]) => message === "1 search result found for Moria.",
      ),
    ).toBe(false);

    await act(async () => {
      second.resolve([result("2", "The Shire")]);
      await second.promise;
    });
    expect(
      await screen.findByText("The Shire description", {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
    expect(
      announce.mock.calls.filter(
        ([message]) => message === "1 search result found for The Shire.",
      ),
    ).toHaveLength(1);
  });

  it("opens a result with a decoded typed Expo Router slug", async () => {
    mockSearch.mockResolvedValueOnce([result("1", "Beyoncé / discography")]);
    renderSearch("Beyoncé");

    const link = await screen.findByRole("link", { name: /Beyoncé/ });
    fireEvent.press(link);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/article/[slug]",
      params: { slug: "Beyoncé_/_discography" },
    });
  });

  it("focuses the route heading once per term and never for async completion", async () => {
    const first = deferred<WikipediaSearchResult[]>();
    const second = deferred<WikipediaSearchResult[]>();
    mockSearch.mockImplementation(({ term }) =>
      term === "Moria" ? first.promise : second.promise,
    );
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focus = jest.fn();
    const view = renderSearch("Moria", focus);

    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.resolve([result("1", "Moria")]);
      await first.promise;
    });
    await screen.findByRole("link", { name: /Moria/ });
    expect(focus).toHaveBeenCalledTimes(1);

    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <SearchScreen focusHeading={focus} term="The Shire" />
      </GardenThemeProvider>,
    );
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve([result("2", "The Shire")]);
      await second.promise;
    });
    await screen.findByRole("link", { name: /The Shire/ });
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("refines through the canonical route from keyboard submit", async () => {
    mockSearch.mockResolvedValueOnce([result("1", "Moria")]);
    renderSearch("Moria");
    await screen.findByRole("link", { name: /Moria/ });

    const input = screen.getByLabelText("Search topic");
    fireEvent.changeText(input, "The Shire");
    fireEvent(input, "submitEditing");

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/search",
      params: { q: "The Shire" },
    });
  });
});
