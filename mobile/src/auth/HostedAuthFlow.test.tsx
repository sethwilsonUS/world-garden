import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native";
import { AccessibilityInfo, Platform, Pressable, Text } from "react-native";
import { useEffect, type PropsWithChildren } from "react";

import {
  HostedAuthProvider,
  useHostedAuthFlow,
  type HostedAuthOutcome,
} from "./HostedAuthFlow";

const mockStartHostedAuth = jest.fn();
const mockPreparationCommitted = jest.fn();
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);

jest.mock("@clerk/expo/hosted-auth", () => ({
  useHostedAuth: () => ({ startHostedAuth: mockStartHostedAuth }),
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

function usePlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: os,
  });
}

async function flushStateCommits() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function Wrapper({ children }: PropsWithChildren) {
  return <HostedAuthProvider>{children}</HostedAuthProvider>;
}

function Launcher({
  restoreFocus,
}: {
  restoreFocus: (outcome: HostedAuthOutcome) => void;
}) {
  const { authErrorMessage, isAccessibilityActive, isBusy, openAuth } =
    useHostedAuthFlow();

  useEffect(() => {
    if (isBusy && !isAccessibilityActive) {
      mockPreparationCommitted();
    }
  }, [isAccessibilityActive, isBusy]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: isBusy, disabled: isBusy }}
        disabled={isBusy}
        onPress={() => void openAuth({ restoreFocus })}
      >
        <Text>Sign in</Text>
      </Pressable>
      <Text testID="hosted-auth-busy">{isBusy ? "busy" : "idle"}</Text>
      <Text testID="hosted-auth-accessibility">
        {isAccessibilityActive ? "isolated" : "available"}
      </Text>
      <Text testID="hosted-auth-error">{authErrorMessage ?? "none"}</Text>
    </>
  );
}

describe("HostedAuthProvider", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    usePlatform("ios");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    if (originalPlatformDescriptor) {
      Object.defineProperty(Platform, "OS", originalPlatformDescriptor);
    }
  });

  it("fails clearly when the hook escapes its provider", async () => {
    await expect(renderHook(() => useHostedAuthFlow())).rejects.toThrow(
      "useHostedAuthFlow() must be used within HostedAuthProvider",
    );
  });

  it("commits an accessible preparation state before isolating hosted sign-in", async () => {
    usePlatform("android");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockStartHostedAuth.mockReturnValue(new Promise(() => undefined));
    await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={jest.fn()} />
      </HostedAuthProvider>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await flushStateCommits();

    expect(mockStartHostedAuth).toHaveBeenCalledWith();
    expect(mockPreparationCommitted).toHaveBeenCalledTimes(1);
    expect(mockPreparationCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartHostedAuth.mock.invocationCallOrder[0] ?? 0,
    );
    expect(announce).toHaveBeenCalledWith("Opening secure sign-in.");
    expect(announce.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartHostedAuth.mock.invocationCallOrder[0] ?? 0,
    );
    expect(screen.getByTestId("hosted-auth-busy")).toHaveTextContent("busy");
    expect(screen.getByTestId("hosted-auth-accessibility")).toHaveTextContent(
      "isolated",
    );
  });

  it.each([
    ["ios", 250],
    ["android", 1_000],
  ] as const)(
    "restores focus after a cancelled %s browser session settles",
    async (platform, delay) => {
      usePlatform(platform);
      const request = deferred<{
        authSessionResult: { type: "cancel" };
        createdSessionId: null;
      }>();
      let disabledAtRestore: boolean | undefined;
      let accessibilityAtRestore: string | undefined;
      const restoreFocus = jest.fn(() => {
        disabledAtRestore = screen.getByRole("button", {
          name: "Sign in",
        }).props.accessibilityState?.disabled as boolean | undefined;
        accessibilityAtRestore = screen.getByTestId("hosted-auth-accessibility")
          .props.children as string;
      });
      mockStartHostedAuth.mockReturnValue(request.promise);
      await render(
        <HostedAuthProvider>
          <Launcher restoreFocus={restoreFocus} />
        </HostedAuthProvider>,
      );
      await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

      await flushStateCommits();

      await act(async () => {
        request.resolve({
          authSessionResult: { type: "cancel" },
          createdSessionId: null,
        });
        await request.promise;
      });

      expect(restoreFocus).not.toHaveBeenCalled();
      expect(screen.getByTestId("hosted-auth-accessibility")).toHaveTextContent(
        "isolated",
      );

      await act(() => jest.advanceTimersByTime(delay - 1));
      expect(restoreFocus).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });
      await flushStateCommits();
      expect(restoreFocus).toHaveBeenCalledWith("cancelled");
      expect(restoreFocus).toHaveBeenCalledTimes(1);
      expect(disabledAtRestore).toBe(false);
      expect(accessibilityAtRestore).toBe("isolated");
      expect(screen.getByTestId("hosted-auth-busy")).toHaveTextContent("idle");
      expect(screen.getByTestId("hosted-auth-accessibility")).toHaveTextContent(
        "available",
      );
      expect(screen.getByTestId("hosted-auth-error")).toHaveTextContent("none");
    },
  );

  it("reports completion only after Clerk activates the returned session", async () => {
    const restoreFocus = jest.fn();
    mockStartHostedAuth.mockResolvedValue({
      authSessionResult: {
        type: "success",
        url: "org.curiogarden.app.e2e://callback?private=redacted",
      },
      createdSessionId: "sess_private",
    });
    await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={restoreFocus} />
      </HostedAuthProvider>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await flushStateCommits();
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushStateCommits();

    expect(restoreFocus).toHaveBeenCalledWith("completed");
    expect(JSON.stringify(screen.toJSON())).not.toContain("sess_private");
    expect(JSON.stringify(screen.toJSON())).not.toContain("private=redacted");
  });

  it("sanitizes a hosted-auth failure and announces it only after return", async () => {
    const restoreFocus = jest.fn();
    mockStartHostedAuth.mockRejectedValue(
      new Error("token=private callback=https://evil.example"),
    );
    await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={restoreFocus} />
      </HostedAuthProvider>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await flushStateCommits();

    expect(screen.getByTestId("hosted-auth-error")).toHaveTextContent(
      "We couldn't open secure sign-in. Please try again.",
    );
    expect(screen.getByTestId("hosted-auth-accessibility")).toHaveTextContent(
      "isolated",
    );
    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /private|evil\.example/u,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushStateCommits();
    expect(restoreFocus).toHaveBeenCalledWith("error");
    expect(screen.getByTestId("hosted-auth-accessibility")).toHaveTextContent(
      "available",
    );
  });

  it("treats an unloaded Clerk result as an error instead of a cancellation", async () => {
    const restoreFocus = jest.fn();
    mockStartHostedAuth.mockResolvedValue({
      authSessionResult: null,
      createdSessionId: null,
    });
    await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={restoreFocus} />
      </HostedAuthProvider>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await flushStateCommits();
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushStateCommits();

    expect(restoreFocus).toHaveBeenCalledWith("error");
    expect(screen.getByTestId("hosted-auth-error")).toHaveTextContent(
      "We couldn't open secure sign-in. Please try again.",
    );
  });

  it("reports a locked native auth-session slot as a retryable error", async () => {
    const restoreFocus = jest.fn();
    mockStartHostedAuth.mockResolvedValue({
      authSessionResult: { type: "locked" },
      createdSessionId: null,
    });
    await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={restoreFocus} />
      </HostedAuthProvider>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await flushStateCommits();
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushStateCommits();

    expect(restoreFocus).toHaveBeenCalledWith("error");
    expect(screen.getByTestId("hosted-auth-error")).toHaveTextContent(
      "We couldn't open secure sign-in. Please try again.",
    );
  });

  it("shares one in-flight operation across duplicate activation", async () => {
    const request = deferred<{
      authSessionResult: { type: "dismiss" };
      createdSessionId: null;
    }>();
    mockStartHostedAuth.mockReturnValue(request.promise);
    const { result } = await renderHook(() => useHostedAuthFlow(), {
      wrapper: Wrapper,
    });
    const firstRestore = jest.fn();
    const secondRestore = jest.fn();
    let first!: Promise<HostedAuthOutcome>;
    let second!: Promise<HostedAuthOutcome>;

    await act(() => {
      first = result.current.openAuth({ restoreFocus: firstRestore });
      second = result.current.openAuth({ restoreFocus: secondRestore });
    });

    await flushStateCommits();

    expect(second).toBe(first);
    expect(mockStartHostedAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({
        authSessionResult: { type: "dismiss" },
        createdSessionId: null,
      });
      await request.promise;
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushStateCommits();
    await expect(first).resolves.toBe("cancelled");
    expect(firstRestore).toHaveBeenCalledTimes(1);
    expect(secondRestore).not.toHaveBeenCalled();
  });

  it("does not restore focus or update state after unmount", async () => {
    const request = deferred<{
      authSessionResult: { type: "cancel" };
      createdSessionId: null;
    }>();
    const restoreFocus = jest.fn();
    mockStartHostedAuth.mockReturnValue(request.promise);
    const view = await render(
      <HostedAuthProvider>
        <Launcher restoreFocus={restoreFocus} />
      </HostedAuthProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await view.unmount();
    await act(async () => {
      request.resolve({
        authSessionResult: { type: "cancel" },
        createdSessionId: null,
      });
      await request.promise;
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(restoreFocus).not.toHaveBeenCalled();
  });
});
