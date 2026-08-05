import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet, type View } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { AccountScreen } from "./AccountScreen";

type TestProfile = {
  email: string | null;
  name: string | null;
};

type TestAuthState =
  | { profile: null; status: "loading" | "signedOut" | "connecting" }
  | {
      message: string;
      profile: null;
      status: "bridgeError";
    }
  | { profile: TestProfile; status: "ready" };

type TestSignOutResult = { ok: true } | { message: string; ok: false };

const mockOpenAuth = jest.fn();
const mockSignOut = jest.fn<Promise<TestSignOutResult>, []>();
const mockUseNativeAuth = jest.fn();

let mockAuthAccessibilityActive: boolean;
let mockAuthErrorMessage: string | null;
let mockAuthBusy: boolean;
let mockAuthSessionEpoch: symbol;
let authState: TestAuthState;

jest.mock(
  "../auth/NativeAuthContext",
  () => ({
    useNativeAuth: () => mockUseNativeAuth(),
  }),
  { virtual: true },
);

jest.mock("../auth/HostedAuthFlow", () => ({
  useHostedAuthFlow: () => ({
    authErrorMessage: mockAuthErrorMessage,
    isAccessibilityActive: mockAuthAccessibilityActive,
    isBusy: mockAuthBusy,
    openAuth: mockOpenAuth,
  }),
}));

function readyState(
  profile: Partial<TestProfile> = {},
): Extract<TestAuthState, { status: "ready" }> {
  return {
    profile: {
      email: "ada@example.com",
      name: "Ada Lovelace",
      ...profile,
    },
    status: "ready",
  };
}

function renderAccount({
  focusAuthOpener,
  focusHeading,
  isProductionEnvironment = true,
  onBack = jest.fn(),
}: {
  focusAuthOpener?: (element: View) => void;
  focusHeading?: (element: View) => void;
  isProductionEnvironment?: boolean;
  onBack?: () => void;
} = {}) {
  return render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <AccountScreen
        focusAuthOpener={focusAuthOpener}
        focusHeading={focusHeading}
        isProductionEnvironment={isProductionEnvironment}
        onBack={onBack}
      />
    </GardenThemeProvider>,
  );
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

describe("AccountScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAccessibilityActive = false;
    mockAuthErrorMessage = null;
    mockAuthBusy = false;
    mockAuthSessionEpoch = Symbol("session-a");
    authState = { profile: null, status: "signedOut" };
    mockSignOut.mockResolvedValue({ ok: true });
    mockUseNativeAuth.mockImplementation(() => ({
      canSignOut:
        authState.status === "connecting" ||
        authState.status === "bridgeError" ||
        authState.status === "ready",
      sessionEpoch: mockAuthSessionEpoch,
      signOut: mockSignOut,
      state: authState,
    }));
  });

  it.each([
    [
      { profile: null, status: "loading" } as const,
      "Checking session",
      "Checking your account session.",
    ],
    [
      { profile: null, status: "signedOut" } as const,
      "Browse now, sign in anytime",
      "You are browsing in guest mode.",
    ],
    [
      { profile: null, status: "connecting" } as const,
      "Connecting your account",
      "Connecting your account.",
    ],
    [
      {
        message: "We couldn't connect your account. Please try again.",
        profile: null,
        status: "bridgeError",
      } as const,
      "Account connection paused",
      "We couldn't connect your account. Please try again.",
    ],
    [readyState(), "Welcome back", "Your account is connected."],
  ])("renders a persistent, text-distinct %s state", (state, title, status) => {
    authState = state;

    renderAccount();

    expect(
      screen.getByRole("header", { name: "Account & data" }),
    ).toBeOnTheScreen();
    expect(screen.getByText(title)).toBeOnTheScreen();
    expect(screen.getByTestId("account-status")).toHaveTextContent(status);
    expect(screen.getAllByTestId("account-status")).toHaveLength(1);
    expect(
      screen.getByText(
        "The app will not open web account controls until it can verify that the browser and this device use the same account.",
      ),
    ).toBeOnTheScreen();

    if (state.status === "bridgeError") {
      expect(screen.getByTestId("account-status")).toHaveProp(
        "accessibilityRole",
        "alert",
      );
    }

    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /Library|Personal Playlist|listening progress/u,
    );
  });

  it("opens sign-in-or-up with an opener-specific focus callback", () => {
    const focusAuthOpener = jest.fn();
    renderAccount({ focusAuthOpener });
    const signIn = screen.getByRole("button", { name: "Sign in" });

    expect(StyleSheet.flatten(signIn.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    expect(signIn).toHaveProp(
      "accessibilityHint",
      "Opens secure browser sign-in or account creation.",
    );

    fireEvent.press(signIn);

    expect(mockOpenAuth).toHaveBeenCalledTimes(1);
    const restoreFocus = mockOpenAuth.mock.calls[0]?.[0]?.restoreFocus;
    expect(restoreFocus).toEqual(expect.any(Function));

    act(() => restoreFocus("cancelled"));
    expect(focusAuthOpener).toHaveBeenCalledTimes(1);
    expect(focusAuthOpener).toHaveBeenCalledWith(expect.anything());
  });

  it("uses the renderer-aware focus event when hosted auth returns", () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(false);
    const sendAccessibilityEvent = jest.spyOn(
      AccessibilityInfo,
      "sendAccessibilityEvent",
    );
    renderAccount();

    fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    const restoreFocus = mockOpenAuth.mock.calls[0]?.[0]?.restoreFocus;

    act(() => restoreFocus("cancelled"));

    expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    expect(sendAccessibilityEvent).toHaveBeenCalledWith(
      expect.anything(),
      "focus",
    );
  });

  it("returns focus to the Account heading when successful auth removes the opener", () => {
    const focusAuthOpener = jest.fn();
    const focusHeading = jest.fn();
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(false);
    const view = renderAccount({ focusAuthOpener, focusHeading });
    fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    const restoreFocus = mockOpenAuth.mock.calls[0]?.[0]?.restoreFocus;

    authState = readyState();
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen
          focusAuthOpener={focusAuthOpener}
          focusHeading={focusHeading}
          isProductionEnvironment
          onBack={jest.fn()}
        />
      </GardenThemeProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Sign in" }),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByRole("header", { name: "Account & data" }),
    ).toBeOnTheScreen();

    act(() => restoreFocus("completed"));

    expect(focusAuthOpener).not.toHaveBeenCalled();
    expect(focusHeading).toHaveBeenCalledTimes(1);
  });

  it("shows only normalized name and email", () => {
    authState = readyState({
      email: "  ada@example.com\n ",
      name: "  Ada\tLovelace  ",
    });

    renderAccount();

    expect(screen.getByLabelText("Name, Ada Lovelace")).toBeOnTheScreen();
    expect(screen.getByLabelText("Email, ada@example.com")).toBeOnTheScreen();
  });

  it("uses honest profile fallbacks without deriving identity from an ID", () => {
    authState = readyState({ email: null, name: "   " });

    renderAccount();

    expect(screen.getByLabelText("Name, Not provided")).toBeOnTheScreen();
    expect(screen.getByLabelText("Email, Not provided")).toBeOnTheScreen();
  });

  it("keeps sign-out busy, single-submit, and explicitly announced", async () => {
    authState = readyState();
    const request = deferred<TestSignOutResult>();
    mockSignOut.mockReturnValue(request.promise);
    renderAccount();

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    const busyButton = screen.getByRole("button", {
      disabled: true,
      name: "Sign out — in progress",
    });
    expect(busyButton).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
    });
    expect(screen.getByTestId("account-status")).toHaveTextContent(
      "Signing out.",
    );
    fireEvent.press(busyButton);
    expect(mockSignOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({ ok: true });
      await request.promise;
    });
  });

  it("keeps a private-data-free signing-out state while auth suppresses the session", async () => {
    authState = readyState();
    const request = deferred<TestSignOutResult>();
    mockSignOut.mockReturnValue(request.promise);
    const view = renderAccount();

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    authState = { profile: null, status: "signedOut" };
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );

    expect(screen.getByText("Signing out")).toBeOnTheScreen();
    expect(screen.getByTestId("account-status")).toHaveTextContent(
      "Signing out.",
    );
    expect(
      screen.getByRole("button", {
        disabled: true,
        name: "Sign out — in progress",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Ada Lovelace/)).not.toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain("user_secret_123");

    await act(async () => {
      request.resolve({ ok: true });
      await request.promise;
    });

    expect(screen.getByText("Browse now, sign in anytime")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: /Sign out/u }),
    ).not.toBeOnTheScreen();
  });

  it("moves focus to the newly mounted Sign in opener after successful sign-out", async () => {
    authState = readyState();
    const request = deferred<TestSignOutResult>();
    const focusAuthOpener = jest.fn();
    mockSignOut.mockReturnValue(request.promise);
    const view = renderAccount({ focusAuthOpener });

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    authState = { profile: null, status: "signedOut" };
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen
          focusAuthOpener={focusAuthOpener}
          isProductionEnvironment
          onBack={jest.fn()}
        />
      </GardenThemeProvider>,
    );
    expect(focusAuthOpener).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve({ ok: true });
      await request.promise;
    });

    expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
    expect(focusAuthOpener).toHaveBeenCalledTimes(1);
    expect(focusAuthOpener).toHaveBeenCalledWith(expect.anything());
  });

  it("turns a failed sign-out into a safe retryable error", async () => {
    authState = readyState();
    mockSignOut.mockResolvedValue({
      message: "token=user_secret_123 issuer=https://private.example",
      ok: false,
    });
    renderAccount();

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("alert", {
        name: "We couldn't sign you out. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/user_secret_123/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/private\.example/)).not.toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
      await Promise.resolve();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });

  it("reports a failed sign-out when a bridge error recovers to the same account", async () => {
    authState = {
      message: "We couldn't connect your account. Please try again.",
      profile: null,
      status: "bridgeError",
    };
    const request = deferred<TestSignOutResult>();
    mockSignOut.mockReturnValue(request.promise);
    const view = renderAccount();

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    authState = readyState();
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );

    await act(async () => {
      request.resolve({ message: "private bridge detail", ok: false });
      await request.promise;
    });

    expect(
      screen.getByRole("alert", {
        name: "We couldn't sign you out. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/private bridge detail/u)).not.toBeOnTheScreen();
  });

  it("keeps sign out available while the private account bridge is connecting", () => {
    authState = { profile: null, status: "connecting" };

    renderAccount();

    expect(screen.getByRole("button", { name: "Sign out" })).toBeOnTheScreen();
  });

  it("does not attach a late sign-out failure to a replacement Clerk session", async () => {
    authState = {
      message: "We couldn't connect your account. Please try again.",
      profile: null,
      status: "bridgeError",
    };
    const request = deferred<TestSignOutResult>();
    const focusAuthOpener = jest.fn();
    mockSignOut.mockReturnValue(request.promise);
    const view = renderAccount({ focusAuthOpener });

    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    mockAuthSessionEpoch = Symbol("session-b");
    authState = readyState({
      email: "sam@example.com",
      name: "Samwise Gamgee",
    });
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen
          focusAuthOpener={focusAuthOpener}
          isProductionEnvironment
          onBack={jest.fn()}
        />
      </GardenThemeProvider>,
    );

    expect(screen.getByText("Welcome back")).toBeOnTheScreen();
    expect(screen.getByLabelText("Name, Samwise Gamgee")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeOnTheScreen();

    await act(async () => {
      request.resolve({ message: "private session-a detail", ok: false });
      await request.promise;
    });

    expect(screen.queryByText("Signing out")).not.toBeOnTheScreen();
    expect(
      screen.queryByRole("alert", {
        name: "We couldn't sign you out. Please try again.",
      }),
    ).not.toBeOnTheScreen();
    expect(focusAuthOpener).not.toHaveBeenCalled();
  });

  it("suppresses background and routine return announcements without stealing restored focus", () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => undefined);
    mockAuthAccessibilityActive = true;
    const view = renderAccount();

    authState = { profile: null, status: "connecting" };
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("account-status")).toHaveProp(
      "accessible",
      false,
    );
    expect(announce).not.toHaveBeenCalled();

    mockAuthAccessibilityActive = false;
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("account-status")).toHaveProp("accessible", true);
    expect(announce).not.toHaveBeenCalled();

    mockAuthAccessibilityActive = true;
    mockAuthErrorMessage = "We couldn't open secure sign-in. Please try again.";
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );
    mockAuthAccessibilityActive = false;
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen isProductionEnvironment onBack={jest.fn()} />
      </GardenThemeProvider>,
    );

    expect(announce).toHaveBeenCalledWith(
      "We couldn't open secure sign-in. Please try again.",
      { priority: "low", queue: true },
    );
  });

  it("keeps the hosted-auth opener focusable while busy and delegates repeat activation", () => {
    mockAuthBusy = true;

    renderAccount();

    const busyButton = screen.getByRole("button", {
      disabled: false,
      name: "Sign in — in progress",
    });
    expect(busyButton).toHaveProp("accessibilityState", {
      busy: true,
    });
    expect(busyButton).toHaveProp("focusable", true);
    expect(screen.getByTestId("account-status")).toHaveTextContent(
      "Opening secure sign-in.",
    );
    fireEvent.press(busyButton);
    expect(mockOpenAuth).toHaveBeenCalledTimes(1);
  });

  it("shows only a sanitized hosted-auth error after the browser returns", () => {
    mockAuthErrorMessage = "We couldn't open secure sign-in. Please try again.";

    renderAccount();

    expect(
      screen.getByRole("alert", {
        name: "We couldn't open secure sign-in. Please try again.",
      }),
    ).toBeOnTheScreen();
  });

  it("does not hand production identities to an unverified browser session", () => {
    renderAccount();

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.getByText(
        "The app will not open web account controls until it can verify that the browser and this device use the same account.",
      ),
    ).toBeOnTheScreen();
  });

  it("does not send non-production test identities to web account management", () => {
    renderAccount({ isProductionEnvironment: false });

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.getByText(
        "This non-production build uses a separate test account. Export and permanent deletion are unavailable in the app.",
      ),
    ).toBeOnTheScreen();
  });

  it("focuses the route heading once and not again for auth state changes", async () => {
    authState = { profile: null, status: "loading" };
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focusHeading = jest.fn();
    const view = renderAccount({ focusHeading });

    await waitFor(() => expect(focusHeading).toHaveBeenCalledTimes(1));

    authState = readyState();
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccountScreen
          focusHeading={focusHeading}
          isProductionEnvironment
          onBack={jest.fn()}
        />
      </GardenThemeProvider>,
    );

    expect(screen.getByText("Welcome back")).toBeOnTheScreen();
    expect(focusHeading).toHaveBeenCalledTimes(1);
  });

  it("returns through the route-owned safe back action and keeps task text unclamped", () => {
    const onBack = jest.fn();
    renderAccount({ onBack });

    fireEvent.press(screen.getByRole("button", { name: "Back to garden" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText("Account & data", { includeHiddenElements: true }),
    ).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Browse now, sign in anytime")).not.toHaveProp(
      "maxFontSizeMultiplier",
      expect.any(Number),
    );
  });
});
