import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo, Alert, Platform, View } from "react-native";
import type {
  NativeLibraryMutationResult,
  NativeLibraryValue,
} from "../library/NativeLibraryContext";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import {
  confirmLibraryRemoval,
  focusLibraryElement,
  LibraryScreen,
} from "./LibraryScreen";

const entries = [
  { savedAt: 2, slug: "Moria", title: "Moria" },
  { savedAt: 1, slug: "The_Shire", title: "The Shire" },
] as const;

const mockRetry = jest.fn();
const mockSaveBookmark = jest.fn<
  Promise<NativeLibraryMutationResult>,
  [{ slug: string; title: string }]
>();
const mockRemoveBookmark = jest.fn<
  Promise<NativeLibraryMutationResult>,
  [{ slug: string }]
>();
let mockLibraryValue: NativeLibraryValue;
const defaultAccountEpoch = Symbol("account-a");
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);

jest.mock("../library/NativeLibraryContext", () => ({
  useNativeLibrary: () => mockLibraryValue,
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
    retry: mockRetry,
    saveBookmark: mockSaveBookmark,
    state,
  };
}

async function renderLibrary(
  overrides: Partial<React.ComponentProps<typeof LibraryScreen>> = {},
) {
  const props = {
    confirmRemoval: jest.fn(async () => true),
    focusAfterRemoval: jest.fn(),
    onBack: jest.fn(),
    onOpenAccount: jest.fn(),
    onOpenArticle: jest.fn(),
    onStartExploring: jest.fn(),
    ...overrides,
  };
  const createUi = (
    rerenderOverrides: Partial<React.ComponentProps<typeof LibraryScreen>> = {},
  ) => (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <LibraryScreen {...props} {...rerenderOverrides} />
    </GardenThemeProvider>
  );

  return { ...(await render(createUi())), createUi, props };
}

describe("LibraryScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemoveBookmark.mockResolvedValue({ status: "committed" });
    mockSaveBookmark.mockResolvedValue({ status: "committed" });
    setLibrary({ entries: [], status: "ready" });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalPlatformDescriptor) {
      Object.defineProperty(Platform, "OS", originalPlatformDescriptor);
    }
  });

  it("uses one cancellable native confirmation before destructive removal", async () => {
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => undefined);

    const confirmation = confirmLibraryRemoval(entries[0]);
    const [, , buttons, options] = alert.mock.calls[0]!;

    expect(alert).toHaveBeenCalledWith(
      "Remove saved article?",
      "Remove Moria from your Library?",
      expect.arrayContaining([
        expect.objectContaining({ style: "cancel", text: "Cancel" }),
        expect.objectContaining({ style: "destructive", text: "Remove" }),
      ]),
      expect.objectContaining({ cancelable: true }),
    );
    buttons?.find((button) => button.text === "Remove")?.onPress?.();
    options?.onDismiss?.();

    await expect(confirmation).resolves.toBe(true);
  });

  it("restores hardware-keyboard and screen-reader focus to the same target", () => {
    const target = new View({});
    const focus = jest.spyOn(target, "focus").mockImplementation(() => {});
    const sendAccessibilityFocus = jest
      .spyOn(AccessibilityInfo, "sendAccessibilityEvent")
      .mockImplementation(() => {});

    focusLibraryElement(target);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(sendAccessibilityFocus).toHaveBeenCalledWith(target, "focus");
  });

  it("keeps one route heading and one status node through loading and empty states", async () => {
    setLibrary({ entries: [], status: "loading" });
    const view = await renderLibrary();
    const heading = screen.getByTestId("library-screen-heading");
    const status = screen.getByTestId("library-status");

    expect(screen.getAllByRole("header", { name: "Library" })).toHaveLength(1);
    expect(screen.getByText("Loading your Library")).toBeOnTheScreen();
    expect(status).toHaveAccessibleName("Loading your Library.");

    setLibrary({ entries: [], status: "ready" });
    await view.rerender(view.createUi());

    expect(screen.getByTestId("library-screen-heading")).toBe(heading);
    expect(screen.getByTestId("library-status")).toBe(status);
    expect(screen.getByText("No saved articles yet")).toBeOnTheScreen();
    expect(
      screen.getByText("Save articles while browsing and they’ll appear here."),
    ).toBeOnTheScreen();
  });

  it("keeps signed-out reading public and sends account work to Account", async () => {
    setLibrary({ entries: [], status: "signedOut" });
    const { props } = await renderLibrary();

    expect(
      screen.getByText("Sign in to see your saved articles"),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your Library is tied to your Curio Garden account. Articles stay public while you’re signed out.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/saved on this device/i)).not.toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Go to Account" }),
    );
    expect(props.onOpenAccount).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getByRole("button", { name: "Start exploring" }),
    );
    expect(props.onStartExploring).toHaveBeenCalledTimes(1);
  });

  it("shows sanitized recovery copy and retries without replacing the heading or status", async () => {
    setLibrary({
      entries: [],
      message: "We couldn’t load your Library. Please try again.",
      status: "error",
    });
    await renderLibrary();

    expect(
      screen.getByRole("alert", {
        name: "We couldn’t load your Library. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/token|issuer|stack/i)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("opens exact slugs and keeps list links before their sibling Remove controls", async () => {
    setLibrary({ entries, status: "ready" });
    const { props } = await renderLibrary();

    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "2 saved articles.",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    await fireEvent.press(screen.getAllByRole("link")[1]!);
    expect(props.onOpenArticle).toHaveBeenCalledWith("The_Shire");
  });

  it("confirms removal and restores focus to the next article after commit", async () => {
    setLibrary({ entries, status: "ready" });
    const focusAfterRemoval = jest.fn();
    const confirmRemoval = jest.fn(async () => true);
    await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );

    await waitFor(() =>
      expect(confirmRemoval).toHaveBeenCalledWith(entries[0]),
    );
    expect(mockRemoveBookmark).toHaveBeenCalledWith({ slug: "Moria" });
    await waitFor(() => expect(focusAfterRemoval).toHaveBeenCalledTimes(1));
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Moria removed from your Library.",
    );
  });

  it("still recovers after native confirmation refocuses the invoking row", async () => {
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    await renderLibrary({ focusAfterRemoval });
    const removeMoria = screen.getByRole("button", {
      name: "Remove Moria from your Library",
    });

    await fireEvent(removeMoria, "focus");
    await fireEvent.press(removeMoria);
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));
    await fireEvent(removeMoria, "focus");

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await waitFor(() => expect(focusAfterRemoval).toHaveBeenCalledTimes(1));
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
  });

  it("does not steal focus after the user moves to a route control", async () => {
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    await renderLibrary({ focusAfterRemoval });
    const removeMoria = screen.getByRole("button", {
      name: "Remove Moria from your Library",
    });

    await fireEvent(removeMoria, "focus");
    await fireEvent.press(removeMoria);
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));
    await fireEvent(screen.getByRole("header", { name: "Library" }), "focus");

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(focusAfterRemoval).not.toHaveBeenCalled();
  });

  it("leaves data and focus unchanged when removal confirmation is cancelled", async () => {
    setLibrary({ entries, status: "ready" });
    const focusAfterRemoval = jest.fn();
    const confirmRemoval = jest.fn(async () => false);
    await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );

    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));
    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(focusAfterRemoval).not.toHaveBeenCalled();
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "2 saved articles.",
    );
  });

  it("recovers focus when account sync removes the invoking entry before cancellation", async () => {
    jest.useFakeTimers();
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    await act(async () => {
      resolveConfirmation?.(false);
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
  });

  it("recovers focus when account sync removes the invoking entry before confirmation fails", async () => {
    jest.useFakeTimers();
    let rejectConfirmation: ((error: Error) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectConfirmation = reject;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    await act(async () => {
      rejectConfirmation?.(new Error("private confirmation failure"));
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("alert", {
        name: "We couldn’t update your Library. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
    expect(
      screen.queryByText(/private confirmation failure/i),
    ).not.toBeOnTheScreen();
  });

  it("abandons a confirmation that resolves after the account changes", async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" }, [], Symbol("account-b"));
    await view.rerender(view.createUi());
    await act(async () => {
      resolveConfirmation?.(true);
      await Promise.resolve();
    });

    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(focusAfterRemoval).not.toHaveBeenCalled();
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Loading your Library.",
    );
  });

  it("abandons a confirmed removal and focuses the heading when the same account becomes unavailable", async () => {
    jest.useFakeTimers();
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    await act(async () => {
      resolveConfirmation?.(true);
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBeNull();
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Loading your Library.",
    );
  });

  it("restores the invoking article after a transient outage cancels confirmation", async () => {
    jest.useFakeTimers();
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    setLibrary({ entries, status: "ready" });
    await view.rerender(view.createUi());
    await act(async () => {
      resolveConfirmation?.(false);
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("Moria");
  });

  it("reveals the latest Library error only after native confirmation closes", async () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "ios",
    });
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => undefined);
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmRemoval = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(1));
    announce.mockClear();

    setLibrary({
      entries: [],
      message: "We couldn’t load your Library. Please try again.",
      status: "error",
    });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveProp(
      "accessible",
      false,
    );
    expect(announce).not.toHaveBeenCalled();

    await act(async () => {
      resolveConfirmation?.(false);
      await Promise.resolve();
    });
    expect(screen.getByTestId("library-status")).toHaveProp("accessible", true);
    expect(announce).toHaveBeenCalledWith(
      "We couldn’t load your Library. Please try again.",
      { priority: "low", queue: true },
    );
  });

  it("serializes removals so a second request cannot strand the first", async () => {
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const confirmRemoval = jest.fn(async () => true);
    setLibrary({ entries, status: "ready" });
    await renderLibrary({ confirmRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    const blockedSecondRemoval = await screen.findByRole("button", {
      name: "Remove — wait: The Shire. Another Library removal is in progress.",
    });
    await fireEvent.press(blockedSecondRemoval);

    expect(confirmRemoval).toHaveBeenCalledTimes(1);
    expect(mockRemoveBookmark).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Moria removed from your Library.",
    );
  });

  it("does not let an older reconnecting operation steal focus from a newer confirmation", async () => {
    jest.useFakeTimers();
    let resolveFirstRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    let resolveSecondConfirmation: ((confirmed: boolean) => void) | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirstRemoval = resolve;
        }),
    );
    const confirmRemoval = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondConfirmation = resolve;
          }),
      );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ confirmRemoval, focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove The Shire from your Library",
      }),
    );
    await waitFor(() => expect(confirmRemoval).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirstRemoval?.({
        message: "We couldn’t remove this article. Please try again.",
        status: "failed",
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "1 saved article.",
    );
    expect(
      screen.getByRole("button", {
        name: "Remove — in progress: The Shire from your Library",
      }),
    ).toBeOnTheScreen();

    await act(async () => {
      resolveSecondConfirmation?.(false);
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());
    expect(focusAfterRemoval).not.toHaveBeenCalled();
  });

  it("focuses the heading after removing the only article", async () => {
    setLibrary({ entries: [entries[0]], status: "ready" });
    const focusAfterRemoval = jest.fn();
    await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );

    await waitFor(() => expect(focusAfterRemoval).toHaveBeenCalledTimes(1));
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBeNull();
  });

  it("focuses the previous article when the removed entry has no next sibling", async () => {
    setLibrary({ entries, status: "ready" });
    const focusAfterRemoval = jest.fn();
    await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove The Shire from your Library",
      }),
    );

    await waitFor(() => expect(focusAfterRemoval).toHaveBeenCalledTimes(1));
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("Moria");
  });

  it("recovers focus when account sync removes the invoking entry before mutation failure", async () => {
    jest.useFakeTimers();
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    await act(async () => {
      resolveRemoval?.({
        message: "We couldn’t remove this article. Please try again.",
        status: "failed",
      });
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(
      screen.getByRole("alert", {
        name: "We couldn’t remove this article. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
  });

  it("immediately recovers focus when the Library becomes unavailable during a hanging mutation", async () => {
    jest.useFakeTimers();
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries: [entries[0]], status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    await act(() => jest.runOnlyPendingTimers());

    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBeNull();

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
  });

  it("keeps one stable recovery target through a transient mutation outage", async () => {
    jest.useFakeTimers();
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries: [entries[0]], status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    setLibrary({ entries: [entries[0]], status: "ready" });
    await view.rerender(view.createUi());
    await act(() => jest.runOnlyPendingTimers());
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBeNull();

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
  });

  it("suppresses hidden-route announcements and focus after leaving Library", async () => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "ios",
    });
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => undefined);
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    const removeMoria = screen.getByRole("button", {
      name: "Remove Moria from your Library",
    });
    await fireEvent(removeMoria, "focus");
    await fireEvent.press(removeMoria);
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));
    await fireEvent(screen.getAllByRole("link")[0]!, "focus");

    await view.rerender(view.createUi({ isRouteActive: false }));
    announce.mockClear();
    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi({ isRouteActive: false }));
    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());

    expect(announce).not.toHaveBeenCalled();
    expect(focusAfterRemoval).not.toHaveBeenCalled();
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "1 saved article.",
    );

    await view.rerender(view.createUi({ isRouteActive: true }));
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
  });

  it("announces only sanitized failures and ignores superseded account operations", async () => {
    setLibrary({ entries, status: "ready" });
    mockRemoveBookmark
      .mockResolvedValueOnce({
        message: "We couldn’t update your Library. Please try again.",
        status: "failed",
      })
      .mockResolvedValueOnce({ status: "superseded" });
    const focusAfterRemoval = jest.fn();
    await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    expect(
      await screen.findByRole("alert", {
        name: "We couldn’t update your Library. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/token|issuer|stack/i)).not.toBeOnTheScreen();
    expect(focusAfterRemoval).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove The Shire from your Library",
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(focusAfterRemoval).not.toHaveBeenCalled();
  });

  it("does not carry an operation announcement into a later account state", async () => {
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary();
    const nextAccountEpoch = Symbol("account-b");

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("library-status")).toHaveAccessibleName(
        "Moria removed from your Library.",
      ),
    );

    setLibrary({ entries: [], status: "loading" }, [], nextAccountEpoch);
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Loading your Library.",
    );

    setLibrary(
      { entries: [entries[1]], status: "ready" },
      [],
      nextAccountEpoch,
    );
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "1 saved article.",
    );
  });

  it("does not replay an operation announcement after same-account reconnect", async () => {
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary();

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("library-status")).toHaveAccessibleName(
        "Moria removed from your Library.",
      ),
    );

    setLibrary({ entries: [], status: "loading" });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Loading your Library.",
    );

    setLibrary({ entries, status: "ready" });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "2 saved articles.",
    );
  });

  it("keeps one removal success through its query echo, then reports newer sync", async () => {
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary();

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("library-status")).toHaveAccessibleName(
        "Moria removed from your Library.",
      ),
    );

    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "Moria removed from your Library.",
    );

    setLibrary({
      entries: [
        entries[1],
        { savedAt: 3, slug: "Rivendell", title: "Rivendell" },
      ],
      status: "ready",
    });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "2 saved articles.",
    );
  });

  it("replaces a removal failure when a newer ready-state sync arrives", async () => {
    mockRemoveBookmark.mockResolvedValue({
      message: "We couldn’t update your Library. Please try again.",
      status: "failed",
    });
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary();

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    expect(
      await screen.findByRole("alert", {
        name: "We couldn’t update your Library. Please try again.",
      }),
    ).toBeOnTheScreen();

    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    expect(screen.getByTestId("library-status")).toHaveAccessibleName(
      "1 saved article.",
    );
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
  });

  it("recovers tracked input focus after another client removes its row", async () => {
    jest.useFakeTimers();
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    await fireEvent(screen.getAllByRole("link")[0]!, "focus");
    setLibrary({ entries: [entries[1]], status: "ready" });
    await view.rerender(view.createUi());
    await act(() => jest.runOnlyPendingTimers());

    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBe("The_Shire");
  });

  it("recovers a remotely removed focused row during an unrelated mutation", async () => {
    jest.useFakeTimers();
    let resolveRemoval:
      | ((result: NativeLibraryMutationResult) => void)
      | undefined;
    mockRemoveBookmark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const focusAfterRemoval = jest.fn();
    setLibrary({ entries, status: "ready" });
    const view = await renderLibrary({ focusAfterRemoval });

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Remove Moria from your Library",
      }),
    );
    await waitFor(() => expect(mockRemoveBookmark).toHaveBeenCalledTimes(1));
    await fireEvent(screen.getAllByRole("link")[1]!, "focus");

    setLibrary({ entries: [entries[0]], status: "ready" });
    await view.rerender(view.createUi());
    await act(() => jest.runOnlyPendingTimers());

    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
    expect(focusAfterRemoval.mock.calls[0]?.[1]).toBeNull();

    await act(async () => {
      resolveRemoval?.({ status: "committed" });
      await Promise.resolve();
    });
    await act(() => jest.runOnlyPendingTimers());
    expect(focusAfterRemoval).toHaveBeenCalledTimes(1);
  });

  it("focuses the route heading once while query updates never steal focus", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focusHeading = jest.fn();
    setLibrary({ entries: [], status: "loading" });
    const view = await renderLibrary({ focusHeading });

    await waitFor(() => expect(focusHeading).toHaveBeenCalledTimes(1));
    setLibrary({ entries, status: "ready" });
    await view.rerender(view.createUi());
    expect(focusHeading).toHaveBeenCalledTimes(1);
  });
});
