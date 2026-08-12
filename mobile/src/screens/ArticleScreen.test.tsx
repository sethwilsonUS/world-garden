import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import type { WikipediaArticle } from "@curio-garden/domain";
import type {
  NativeLibraryMutationResult,
  NativeLibraryValue,
} from "../library/NativeLibraryContext";
import type { NativeArticleAudioPlayerProps } from "../media/NativeArticleAudioPlayer";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { ArticleScreen } from "./ArticleScreen";

const mockFetchArticle = jest.fn<
  Promise<WikipediaArticle>,
  [{ slug: string }]
>();
const mockLibraryRetry = jest.fn();
const mockSaveBookmark = jest.fn<
  Promise<NativeLibraryMutationResult>,
  [{ slug: string; title: string }]
>();
const mockRemoveBookmark = jest.fn<
  Promise<NativeLibraryMutationResult>,
  [{ slug: string }]
>();
const mockArticleAudioPlayer = jest.fn<null, [NativeArticleAudioPlayerProps]>(
  () => null,
);
let mockLibraryValue: NativeLibraryValue;
const defaultAccountEpoch = Symbol("account-a");

jest.mock("../data/WikipediaReaderContext", () => ({
  useWikipediaReader: () => ({ fetchArticle: mockFetchArticle }),
}));

jest.mock("../library/NativeLibraryContext", () => ({
  useNativeLibrary: () => mockLibraryValue,
}));

jest.mock("../media/NativeArticleAudioPlayer", () => ({
  NativeArticleAudioPlayer: (props: NativeArticleAudioPlayerProps) =>
    mockArticleAudioPlayer(props),
}));

function setLibrary(
  state: NativeLibraryValue["state"],
  mutatingSlugs: readonly string[] = [],
  accountEpoch: symbol = defaultAccountEpoch,
) {
  mockLibraryValue = {
    accountEpoch,
    isMutating: (slug) => mutatingSlugs.includes(slug),
    removeBookmark: mockRemoveBookmark,
    retry: mockLibraryRetry,
    saveBookmark: mockSaveBookmark,
    state,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function article(
  title: string,
  overrides: Partial<WikipediaArticle> = {},
): WikipediaArticle {
  return {
    wikiPageId: "736",
    revisionId: "1234",
    title,
    language: "en",
    narrationVersion: 2,
    summary: `${title} summary`,
    sections: [
      {
        wikiSectionIndex: "1",
        title: "History",
        level: 2,
        content: `${title} history`,
      },
    ],
    ...overrides,
  };
}

function renderArticle(
  slug: string,
  overrides: Partial<React.ComponentProps<typeof ArticleScreen>> = {},
) {
  const props = {
    onBack: jest.fn(),
    onOpenAccount: jest.fn(),
    slug,
    ...overrides,
  };

  const view = render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <ArticleScreen {...props} />
    </GardenThemeProvider>,
  );

  return { ...view, props };
}

describe("ArticleScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveBookmark.mockResolvedValue({ status: "committed" });
    mockRemoveBookmark.mockResolvedValue({ status: "committed" });
    setLibrary({ entries: [], status: "ready" });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("fetches the exact decoded slug and keeps one status node through ready", async () => {
    const request = deferred<WikipediaArticle>();
    mockFetchArticle.mockReturnValue(request.promise);
    renderArticle("AC/DC");

    await waitFor(() => {
      expect(mockFetchArticle).toHaveBeenCalledWith({ slug: "AC/DC" });
      expect(screen.getByText("Loading AC/DC.")).toBeOnTheScreen();
    });
    const status = screen.getByTestId("article-status");

    await act(async () => {
      request.resolve(article("AC/DC"));
      await request.promise;
    });

    expect(screen.getByTestId("article-status")).toBe(status);
    expect(
      screen.getByText("Article loaded. 1 section available."),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole("header", { name: "AC/DC" })).toHaveLength(1);
    expect(screen.getByRole("header", { name: "History" })).toBeOnTheScreen();
  });

  it("gives ready article audio the exact route and immutable article identity", async () => {
    const request = deferred<WikipediaArticle>();
    mockFetchArticle.mockReturnValue(request.promise);
    renderArticle("AC/DC");

    await waitFor(() => expect(mockFetchArticle).toHaveBeenCalledTimes(1));
    expect(mockArticleAudioPlayer).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve(
        article("Alternating current/direct current", {
          narrationVersion: 7,
          revisionId: "987654",
        }),
      );
      await request.promise;
    });

    await screen.findByText("Alternating current/direct current summary");
    expect(mockArticleAudioPlayer.mock.calls.at(-1)?.[0]).toEqual({
      active: true,
      article: article("Alternating current/direct current", {
        narrationVersion: 7,
        revisionId: "987654",
      }),
      slug: "AC/DC",
      summaryDisclosure: null,
    });
  });

  it("deactivates ready article audio when its article route is inactive", async () => {
    mockFetchArticle.mockResolvedValue(
      article("Moria", {
        narrationVersion: 11,
        revisionId: "456789",
      }),
    );
    const view = renderArticle("Moria");

    await screen.findByText("Moria summary");
    expect(mockArticleAudioPlayer.mock.calls.at(-1)?.[0]).toEqual({
      active: true,
      article: article("Moria", {
        narrationVersion: 11,
        revisionId: "456789",
      }),
      slug: "Moria",
      summaryDisclosure: null,
    });

    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} isRouteActive={false} />
      </GardenThemeProvider>,
    );

    expect(mockArticleAudioPlayer.mock.calls.at(-1)?.[0]).toEqual({
      active: false,
      article: article("Moria", {
        narrationVersion: 11,
        revisionId: "456789",
      }),
      slug: "Moria",
      summaryDisclosure: null,
    });
  });

  it("announces a readable untitled section that receives a fallback heading", async () => {
    mockFetchArticle.mockResolvedValue(
      article("The Shire", {
        sections: [
          {
            wikiSectionIndex: "4",
            title: " ",
            level: 2,
            content: "A party of special magnificence.",
          },
        ],
      }),
    );
    renderArticle("The_Shire");

    expect(
      await screen.findByText("Article loaded. 1 section available."),
    ).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Section 1" })).toBeOnTheScreen();
  });

  it("keeps heading and status identities through a safe error and retry", async () => {
    const retry = deferred<WikipediaArticle>();
    mockFetchArticle.mockRejectedValueOnce(
      new Error("Convex token=secret internal stack"),
    );
    renderArticle("the_silmaril");

    expect(
      await screen.findByRole("alert", {
        name: "Could not load this article. Check your connection and try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/token=secret/i)).not.toBeOnTheScreen();
    const heading = screen.getByTestId("article-screen-heading");
    const status = screen.getByTestId("article-status");
    expect(heading).toHaveAccessibleName("the silmaril");

    mockFetchArticle.mockReturnValueOnce(retry.promise);
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Loading the silmaril.");
    expect(screen.getByTestId("article-screen-heading")).toBe(heading);
    expect(screen.getByTestId("article-status")).toBe(status);

    await act(async () => {
      retry.resolve(article("The Silmaril"));
      await retry.promise;
    });

    expect(mockFetchArticle).toHaveBeenCalledTimes(2);
    expect(screen.getByText("The Silmaril summary")).toBeOnTheScreen();
    expect(screen.getByTestId("article-screen-heading")).toBe(heading);
    expect(screen.getByTestId("article-status")).toBe(status);
    expect(heading).toHaveAccessibleName("The Silmaril");
  });

  it("times out a stalled request and lets the user retry", async () => {
    jest.useFakeTimers();
    const stalled = deferred<WikipediaArticle>();
    mockFetchArticle
      .mockReturnValueOnce(stalled.promise)
      .mockResolvedValueOnce(article("The Silmaril"));
    renderArticle("the_silmaril");

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchArticle).toHaveBeenCalledWith({ slug: "the_silmaril" });

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(
      screen.getByRole("alert", {
        name: "Could not load this article. Check your connection and try again.",
      }),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchArticle).toHaveBeenCalledTimes(2);
    expect(screen.getByText("The Silmaril summary")).toBeOnTheScreen();
  });

  it("clears a stale timeout when the article route changes", async () => {
    jest.useFakeTimers();
    const stalled = deferred<WikipediaArticle>();
    mockFetchArticle.mockImplementation(({ slug }) =>
      slug === "Moria"
        ? stalled.promise
        : Promise.resolve(article("The Shire")),
    );
    const view = renderArticle("Moria");

    await act(async () => {
      await Promise.resolve();
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen
          onBack={view.props.onBack}
          onOpenAccount={view.props.onOpenAccount}
          slug="The_Shire"
        />
      </GardenThemeProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("The Shire summary")).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
    expect(screen.getByText("The Shire summary")).toBeOnTheScreen();
  });

  it("ignores a stale completion when the article route changes", async () => {
    const first = deferred<WikipediaArticle>();
    const second = deferred<WikipediaArticle>();
    mockFetchArticle.mockImplementation(({ slug }) =>
      slug === "Moria" ? first.promise : second.promise,
    );
    const view = renderArticle("Moria");

    await waitFor(() => expect(mockFetchArticle).toHaveBeenCalledTimes(1));
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen
          onBack={view.props.onBack}
          onOpenAccount={view.props.onOpenAccount}
          slug="The_Shire"
        />
      </GardenThemeProvider>,
    );
    await waitFor(() => expect(mockFetchArticle).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(article("Moria"));
      await first.promise;
    });
    expect(screen.queryByText("Moria summary")).not.toBeOnTheScreen();

    await act(async () => {
      second.resolve(article("The Shire"));
      await second.promise;
    });
    expect(await screen.findByText("The Shire summary")).toBeOnTheScreen();
  });

  it("does not update after unmount", async () => {
    const request = deferred<WikipediaArticle>();
    mockFetchArticle.mockReturnValue(request.promise);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = renderArticle("Entwives");

    await waitFor(() => expect(mockFetchArticle).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      request.resolve(article("Entwives"));
      await request.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("focuses the route heading once and never for retry, load, or link errors", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focusHeading = jest.fn();
    const openUrl = jest.fn().mockRejectedValue(new Error("browser secret"));
    mockFetchArticle.mockRejectedValueOnce(new Error("offline"));
    renderArticle("Moria", { focusHeading, openUrl });

    await screen.findByRole("alert", { name: /Could not load/i });
    await waitFor(() => expect(focusHeading).toHaveBeenCalledTimes(1));

    mockFetchArticle.mockResolvedValueOnce(article("Moria"));
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Moria summary");
    expect(focusHeading).toHaveBeenCalledTimes(1);

    fireEvent.press(
      screen.getByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );
    expect(
      await screen.findByRole("alert", {
        name: "Could not open this link. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/browser secret/i)).not.toBeOnTheScreen();
    expect(focusHeading).toHaveBeenCalledTimes(1);
  });

  it("clears a previous link error when the user tries a link again", async () => {
    const openUrl = jest
      .fn()
      .mockRejectedValueOnce(new Error("browser failed"))
      .mockResolvedValueOnce(undefined);
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria", { openUrl });
    const link = await screen.findByRole("link", {
      name: "Open richer article features on Curio Garden web",
    });

    fireEvent.press(link);
    expect(
      await screen.findByText("Could not open this link. Please try again."),
    ).toBeOnTheScreen();

    fireEvent.press(link);
    await waitFor(() => {
      expect(
        screen.queryByText("Could not open this link. Please try again."),
      ).not.toBeOnTheScreen();
    });
  });

  it("announces an external-link failure while the Library is unavailable", async () => {
    setLibrary({
      entries: [],
      message: "We couldn’t load your Library. Please try again.",
      status: "error",
    });
    const openUrl = jest
      .fn()
      .mockRejectedValue(new Error("private browser failure"));
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria", { openUrl });

    fireEvent.press(
      await screen.findByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Could not open this link. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText(/private browser failure/i),
    ).not.toBeOnTheScreen();
  });

  it("replaces a link failure with the latest Library retry failure", async () => {
    const libraryError = {
      entries: [] as const,
      message: "We couldn’t load your Library. Please try again.",
      status: "error" as const,
    };
    setLibrary(libraryError);
    const openUrl = jest
      .fn()
      .mockRejectedValue(new Error("private browser failure"));
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria", { openUrl });

    fireEvent.press(
      await screen.findByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );
    expect(
      await screen.findByRole("alert", {
        name: "Could not open this link. Please try again.",
      }),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Try Library again" }));
    expect(mockLibraryRetry).toHaveBeenCalledTimes(1);

    setLibrary({ entries: [], status: "loading" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Connecting your Library.",
    );

    setLibrary(libraryError);
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "We couldn’t load your Library. Please try again.",
    );
    expect(
      screen.queryByText("Could not open this link. Please try again."),
    ).not.toBeOnTheScreen();
  });

  it("ignores an older failure after a different external link succeeds", async () => {
    const olderLaunch = deferred<unknown>();
    const openUrl = jest.fn((url: string) =>
      url.startsWith("https://curiogarden.org/")
        ? olderLaunch.promise
        : Promise.resolve(),
    );
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria", { openUrl });

    fireEvent.press(
      await screen.findByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );
    fireEvent.press(
      screen.getByRole("link", { name: "View Wikipedia revision 1234" }),
    );
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(2));

    olderLaunch.reject(new Error("obsolete browser failure"));
    await expect(olderLaunch.promise).rejects.toThrow(
      "obsolete browser failure",
    );

    expect(
      screen.queryByText("Could not open this link. Please try again."),
    ).not.toBeOnTheScreen();
  });

  it("offers explicit Back and retry controls", async () => {
    mockFetchArticle
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(article("Moria"));
    const view = renderArticle("Moria");

    await screen.findByRole("button", { name: "Try again" });
    fireEvent.press(screen.getByRole("button", { name: "Back to search" }));
    expect(view.props.onBack).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Moria summary")).toBeOnTheScreen();
  });

  it("names an article return path honestly when opened from Library", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria", { backLabel: "Back to Library" });

    const back = await screen.findByRole("button", {
      name: "Back to Library",
    });
    expect(back).toHaveProp(
      "accessibilityHint",
      "Returns to your saved articles.",
    );
    fireEvent.press(back);
    expect(view.props.onBack).toHaveBeenCalledTimes(1);
  });

  it("saves a ready article to the signed-in Library through the persistent status", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria");

    await screen.findByText("Moria summary");
    const status = screen.getByTestId("article-status");
    const save = screen.getByRole("button", {
      name: "Save to Library: Moria",
    });
    expect(screen.getByText("Save to Library")).toBeOnTheScreen();

    fireEvent.press(save);

    await waitFor(() =>
      expect(mockSaveBookmark).toHaveBeenCalledWith({
        slug: "Moria",
        title: "Moria",
      }),
    );
    expect(screen.getByTestId("article-status")).toBe(status);
    expect(status).toHaveAccessibleName("Moria saved to your Library.");
  });

  it("removes an already-saved article and exposes selected state in words", async () => {
    setLibrary({
      entries: [{ savedAt: 1, slug: "Moria", title: "Moria" }],
      status: "ready",
    });
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria");

    const remove = await screen.findByRole("button", {
      name: "Saved to Library: remove Moria",
    });
    expect(screen.getByText("Saved to Library")).toBeOnTheScreen();
    expect(remove).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      selected: true,
    });

    fireEvent.press(remove);

    await waitFor(() =>
      expect(mockRemoveBookmark).toHaveBeenCalledWith({ slug: "Moria" }),
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Moria removed from your Library.",
    );
  });

  it("keeps public reading available while signed out and routes saving to Account", async () => {
    setLibrary({ entries: [], status: "signedOut" }, [], Symbol("signed-out"));
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");

    expect(await screen.findByText("Moria summary")).toBeOnTheScreen();
    expect(screen.queryByText("Save to Library")).not.toBeOnTheScreen();
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Signed out. Sign in to save articles to your Library.",
    );
    expect(
      screen.getByText("Sign in to save articles to your Library."),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Go to Account" }));
    expect(view.props.onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps a mutating article action present and unavailable", async () => {
    setLibrary({ entries: [], status: "ready" }, ["Moria"]);
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria");

    const button = await screen.findByRole("button", {
      name: "Save to Library — in progress: Moria",
    });
    expect(button).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
      selected: false,
    });
    fireEvent.press(button);
    expect(mockSaveBookmark).not.toHaveBeenCalled();
  });

  it("surfaces only sanitized Library failures and ignores superseded account work", async () => {
    mockSaveBookmark
      .mockResolvedValueOnce({
        message: "We couldn’t update your Library. Please try again.",
        status: "failed",
      })
      .mockResolvedValueOnce({ status: "superseded" });
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria");
    const save = await screen.findByRole("button", {
      name: "Save to Library: Moria",
    });

    fireEvent.press(save);
    expect(
      await screen.findByRole("alert", {
        name: "We couldn’t update your Library. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/token|issuer|stack/i)).not.toBeOnTheScreen();

    fireEvent.press(save);
    await waitFor(() => expect(mockSaveBookmark).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library action stopped. Check the current saved state before trying again.",
    );
  });

  it("clears an account action announcement when the Library leaves ready", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    const save = await screen.findByRole("button", {
      name: "Save to Library: Moria",
    });

    fireEvent.press(save);
    await waitFor(() =>
      expect(screen.getByTestId("article-status")).toHaveAccessibleName(
        "Moria saved to your Library.",
      ),
    );

    setLibrary({ entries: [], status: "signedOut" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Signed out. Sign in to save articles to your Library.",
    );
    expect(
      screen.getByText("Sign in to save articles to your Library."),
    ).toBeOnTheScreen();

    setLibrary({ entries: [], status: "ready" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library connected.",
    );
  });

  it("does not replay an in-flight save completion after Library reconnect", async () => {
    const saveRequest = deferred<NativeLibraryMutationResult>();
    mockSaveBookmark.mockReturnValue(saveRequest.promise);
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    const save = await screen.findByRole("button", {
      name: "Save to Library: Moria",
    });

    fireEvent.press(save);
    await waitFor(() => expect(mockSaveBookmark).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    await act(async () => {
      saveRequest.resolve({ status: "committed" });
      await saveRequest.promise;
    });

    setLibrary({ entries: [], status: "ready" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library connected.",
    );
  });

  it("reports Library recovery without replaying the old article-loaded event", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    await screen.findByText("Moria summary");
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Article loaded. 1 section available.",
    );

    setLibrary({
      entries: [],
      message: "We couldn’t load your Library. Please try again.",
      status: "error",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "We couldn’t load your Library. Please try again.",
    );

    setLibrary({ entries: [], status: "ready" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library connected.",
    );
  });

  it("keeps a save success through its query echo, then reports newer membership", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Save to Library: Moria",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("article-status")).toHaveAccessibleName(
        "Moria saved to your Library.",
      ),
    );

    setLibrary({
      entries: [{ savedAt: 1, slug: "Moria", title: "Moria" }],
      status: "ready",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Moria saved to your Library.",
    );

    setLibrary({ entries: [], status: "ready" });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is not saved to your Library.",
    );
    expect(
      screen.getByRole("button", { name: "Save to Library: Moria" }),
    ).toBeOnTheScreen();
  });

  it("settles from the first post-commit snapshot and follows later membership", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Save to Library: Moria",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("article-status")).toHaveAccessibleName(
        "Moria saved to your Library.",
      ),
    );

    setLibrary({
      entries: [{ savedAt: 2, slug: "Rivendell", title: "Rivendell" }],
      status: "ready",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is not saved to your Library.",
    );
    expect(
      screen.getByRole("button", {
        name: "Save to Library: Moria",
      }),
    ).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      selected: false,
    });

    setLibrary({
      entries: [
        { savedAt: 3, slug: "Moria", title: "Moria" },
        { savedAt: 2, slug: "Rivendell", title: "Rivendell" },
      ],
      status: "ready",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(
      screen.getByRole("button", {
        name: "Saved to Library: remove Moria",
      }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is saved to your Library.",
    );
  });

  it("releases a committed action when no reactive echo arrives", async () => {
    mockFetchArticle.mockResolvedValue(article("Moria"));
    renderArticle("Moria");
    const save = await screen.findByRole("button", {
      name: "Save to Library: Moria",
    });
    jest.useFakeTimers();

    fireEvent.press(save);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", {
        name: "Saved to Library — in progress: remove Moria",
      }),
    ).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
      selected: true,
    });

    act(() => jest.advanceTimersByTime(2_000));
    expect(
      screen.getByRole("button", { name: "Save to Library: Moria" }),
    ).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      selected: false,
    });
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is not saved to your Library.",
    );
  });

  it("replaces a save failure when a newer ready-state sync arrives", async () => {
    mockSaveBookmark.mockResolvedValue({
      message: "We couldn’t update your Library. Please try again.",
      status: "failed",
    });
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Save to Library: Moria",
      }),
    );
    expect(
      await screen.findByRole("alert", {
        name: "We couldn’t update your Library. Please try again.",
      }),
    ).toBeOnTheScreen();

    setLibrary({
      entries: [{ savedAt: 1, slug: "Moria", title: "Moria" }],
      status: "ready",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is saved to your Library.",
    );
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Saved to Library: remove Moria",
      }),
    ).toBeOnTheScreen();
  });

  it("replaces account-specific status on a direct ready account swap", async () => {
    mockSaveBookmark.mockResolvedValue({
      message: "We couldn’t update your Library. Please try again.",
      status: "failed",
    });
    mockFetchArticle.mockResolvedValue(article("Moria"));
    const view = renderArticle("Moria");
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Save to Library: Moria",
      }),
    );
    await screen.findByRole("alert", {
      name: "We couldn’t update your Library. Please try again.",
    });
    setLibrary({
      entries: [{ savedAt: 1, slug: "Moria", title: "Moria" }],
      status: "ready",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library updated. Moria is saved to your Library.",
    );

    setLibrary({ entries: [], status: "ready" }, [], Symbol("account-b"));
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleScreen {...view.props} />
      </GardenThemeProvider>,
    );
    expect(screen.getByTestId("article-status")).toHaveAccessibleName(
      "Library connected to the current account.",
    );
    expect(
      screen.getByRole("button", { name: "Save to Library: Moria" }),
    ).toBeOnTheScreen();
  });
});
