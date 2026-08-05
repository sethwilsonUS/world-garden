import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import type { WikipediaArticle } from "@curio-garden/domain";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { ArticleScreen } from "./ArticleScreen";

const mockFetchArticle = jest.fn<
  Promise<WikipediaArticle>,
  [{ slug: string }]
>();

jest.mock("../data/WikipediaReaderContext", () => ({
  useWikipediaReader: () => ({ fetchArticle: mockFetchArticle }),
}));

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
  });

  afterEach(() => {
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
        <ArticleScreen onBack={view.props.onBack} slug="The_Shire" />
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
});
