import { useAuth, useUser } from "@clerk/expo";
import { act, renderHook } from "@testing-library/react-native";
import { useConvexAuth, useQueries } from "convex/react";
import * as React from "react";
import type { PropsWithChildren } from "react";

import {
  NativeAuthProvider,
  useNativeAuth,
  type NativeSignOutResult,
} from "./NativeAuthContext";

jest.mock("@clerk/expo", () => ({
  useAuth: jest.fn(),
  useUser: jest.fn(),
}));

jest.mock("convex/react", () => ({
  useConvexAuth: jest.fn(),
  useQueries: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const useUserMock = jest.mocked(useUser);
const useConvexAuthMock = jest.mocked(useConvexAuth);
const useQueriesMock = useQueries as jest.Mock;
const clerkSignOut = jest.fn<Promise<void>, []>();

type ClerkAuth = ReturnType<typeof useAuth>;
type ClerkUser = ReturnType<typeof useUser>;
type ConvexAuth = ReturnType<typeof useConvexAuth>;

let clerkAuth: ClerkAuth;
let clerkUser: ClerkUser;
let convexAuth: ConvexAuth;
let viewer: unknown;

function signedInAuth(userId = "user-a", sessionId = "session-a"): ClerkAuth {
  return {
    isLoaded: true,
    isSignedIn: true,
    sessionId,
    signOut: clerkSignOut,
    userId,
  } as unknown as ClerkAuth;
}

function signedOutAuth(): ClerkAuth {
  return {
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut: clerkSignOut,
    userId: null,
  } as unknown as ClerkAuth;
}

function loadingAuth(): ClerkAuth {
  return {
    isLoaded: false,
    isSignedIn: undefined,
    sessionId: undefined,
    signOut: clerkSignOut,
    userId: undefined,
  } as unknown as ClerkAuth;
}

function signedInUser(userId = "user-a"): ClerkUser {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: { id: userId },
  } as ClerkUser;
}

function AuthWrapper({ children }: PropsWithChildren) {
  return <NativeAuthProvider>{children}</NativeAuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  clerkSignOut.mockResolvedValue(undefined);
  clerkAuth = signedInAuth();
  clerkUser = signedInUser();
  convexAuth = {
    isAuthenticated: true,
    isLoading: false,
    isRefreshing: false,
  };
  viewer = {
    email: "ada@example.com",
    name: "Ada Lovelace",
    subject: "user-a",
  };

  useAuthMock.mockImplementation(() => clerkAuth);
  useUserMock.mockImplementation(() => clerkUser);
  useConvexAuthMock.mockImplementation(() => convexAuth);
  useQueriesMock.mockImplementation((queries: Record<string, unknown>) =>
    Object.hasOwn(queries, "nativeViewer") ? { nativeViewer: viewer } : {},
  );
});

describe("NativeAuthProvider", () => {
  it("fails clearly when the hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeAuth())).toThrow(
      "useNativeAuth() must be used within NativeAuthProvider",
    );
  });

  it("keeps Convex query-map identities stable across unrelated renders", () => {
    const { rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const readyQueries = useQueriesMock.mock.calls.at(-1)?.[0];

    act(() => rerender(undefined));
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toBe(readyQueries);

    clerkAuth = signedOutAuth();
    act(() => rerender(undefined));
    const skippedQueries = useQueriesMock.mock.calls.at(-1)?.[0];

    expect(skippedQueries).not.toBe(readyQueries);
    act(() => rerender(undefined));
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toBe(skippedQueries);
  });

  it("keeps one opaque epoch per Clerk session despite fresh hook wrappers", () => {
    const { result, rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const firstEpoch = result.current.sessionEpoch;

    expect(typeof firstEpoch).toBe("symbol");

    clerkAuth = signedInAuth("user-a", "session-a");
    clerkUser = signedInUser("user-a");
    act(() => rerender(undefined));

    expect(result.current.sessionEpoch).toBe(firstEpoch);

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    act(() => rerender(undefined));
    const secondEpoch = result.current.sessionEpoch;

    expect(secondEpoch).not.toBe(firstEpoch);

    clerkAuth = signedOutAuth();
    clerkUser = signedInUser("user-b");
    act(() => rerender(undefined));
    const signedOutEpoch = result.current.sessionEpoch;

    expect(signedOutEpoch).not.toBe(secondEpoch);

    clerkAuth = signedOutAuth();
    act(() => rerender(undefined));

    expect(result.current.sessionEpoch).toBe(signedOutEpoch);
  });

  it("keeps the session epoch stable when React discards memoized values", () => {
    const useMemoSpy = jest
      .spyOn(React, "useMemo")
      .mockImplementation((factory) => factory());

    try {
      const { result, rerender } = renderHook(() => useNativeAuth(), {
        wrapper: AuthWrapper,
      });
      const firstEpoch = result.current.sessionEpoch;

      clerkAuth = signedInAuth("user-a", "session-a");
      clerkUser = signedInUser("user-a");
      act(() => rerender(undefined));

      expect(result.current.sessionEpoch).toBe(firstEpoch);
    } finally {
      useMemoSpy.mockRestore();
    }
  });

  it("keeps pending Clerk sessions loading and skips the private viewer query", () => {
    clerkAuth = loadingAuth();

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(useAuthMock).toHaveBeenCalledWith({
      treatPendingAsSignedOut: false,
    });
    expect(result.current.state).toEqual({
      profile: null,
      status: "loading",
    });
    expect(result.current.canSignOut).toBe(false);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});
  });

  it("preserves a signed-out public client while hiding stale private identity", () => {
    clerkAuth = signedOutAuth();
    clerkUser = signedInUser("user-a");
    viewer = {
      email: "ada@example.com",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });
    expect(result.current.canSignOut).toBe(false);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});
  });

  it.each([
    [
      "Convex authenticates",
      { isAuthenticated: false, isLoading: true, isRefreshing: false },
    ],
    [
      "Convex refreshes a rejected token",
      { isAuthenticated: true, isLoading: false, isRefreshing: true },
    ],
  ] as const)("stays connecting while %s", (_label, nextConvexAuth) => {
    convexAuth = nextConvexAuth;

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "connecting",
    });
    expect(result.current.canSignOut).toBe(true);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});
  });

  it("stays connecting until the authenticated viewer query resolves", () => {
    viewer = undefined;

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "connecting",
    });
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toHaveProperty(
      "nativeViewer",
    );
  });

  it.each([
    ["Convex rejects the Clerk session", undefined, false],
    ["Convex has no viewer", null, true],
    [
      "Convex resolves a different account",
      {
        email: "sam@example.com",
        name: "Samwise Gamgee",
        subject: "user-b",
      },
      true,
    ],
  ] as const)(
    "fails closed with a generic bridge error when %s",
    (_label, nextViewer, isAuthenticated) => {
      convexAuth = {
        isAuthenticated,
        isLoading: false,
        isRefreshing: false,
      };
      viewer = nextViewer;

      const { result } = renderHook(() => useNativeAuth(), {
        wrapper: AuthWrapper,
      });

      expect(result.current.state).toEqual({
        message: "We couldn't connect your account. Please try again.",
        profile: null,
        status: "bridgeError",
      });
      expect(JSON.stringify(result.current.state)).not.toContain("user-a");
      expect(JSON.stringify(result.current.state)).not.toContain("user-b");
    },
  );

  it("fails closed with a generic bridge error when the viewer query fails", () => {
    viewer = new Error(
      "tokenIdentifier=https://issuer.example|user-a backend unavailable",
    );

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      message: "We couldn't connect your account. Please try again.",
      profile: null,
      status: "bridgeError",
    });
    expect(JSON.stringify(result.current.state)).not.toContain(
      "issuer.example",
    );
    expect(JSON.stringify(result.current.state)).not.toContain(
      "tokenIdentifier",
    );
  });

  it("keeps the viewer subject internal after exact account matching", () => {
    viewer = {
      email: "ada@example.com",
      issuer: "https://issuer.example",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      profile: {
        email: "ada@example.com",
        name: "Ada Lovelace",
      },
      status: "ready",
    });
    expect(result.current.state.profile).not.toHaveProperty("subject");
    expect(result.current.state.profile).not.toHaveProperty("issuer");
    expect(result.current.state.profile).not.toHaveProperty("tokenIdentifier");
  });

  it("removes the previous profile synchronously across an account switch", () => {
    const { result, rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    expect(result.current.state.status).toBe("ready");

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    act(() => rerender(undefined));

    expect(result.current.state.status).toBe("bridgeError");
    expect(result.current.state.profile).toBeNull();
    expect(JSON.stringify(result.current.state)).not.toContain(
      "ada@example.com",
    );

    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    act(() => rerender(undefined));

    expect(result.current.state).toEqual({
      profile: {
        email: "sam@example.com",
        name: "Samwise Gamgee",
      },
      status: "ready",
    });
    expect(result.current.state.profile).not.toHaveProperty("subject");
  });

  it("removes the previous profile synchronously when Clerk signs out", () => {
    const { result, rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    expect(result.current.state.status).toBe("ready");

    clerkAuth = signedOutAuth();
    act(() => rerender(undefined));

    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });
  });

  it("hides the ready profile before Clerk sign-out finishes", async () => {
    let resolveSignOut: (() => void) | undefined;
    clerkSignOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );
    const { result, rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let operation: Promise<NativeSignOutResult> | undefined;

    act(() => {
      operation = result.current.signOut();
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });
    expect(result.current.canSignOut).toBe(false);

    clerkAuth = signedOutAuth();
    act(() => rerender(undefined));

    await act(async () => {
      resolveSignOut?.();
      await operation;
    });
    await expect(operation).resolves.toEqual({ ok: true });
    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });
    expect(result.current.canSignOut).toBe(false);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});
  });

  it("releases a successful sign-out suppression before the same session ID returns", async () => {
    let resolveSignOut: (() => void) | undefined;
    clerkSignOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );
    const { result, rerender } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let operation: Promise<NativeSignOutResult> | undefined;

    act(() => {
      operation = result.current.signOut();
    });
    clerkAuth = signedOutAuth();
    act(() => rerender(undefined));

    await act(async () => {
      resolveSignOut?.();
      await operation;
    });

    clerkAuth = signedInAuth("user-a", "session-a");
    clerkUser = signedInUser("user-a");
    act(() => rerender(undefined));

    expect(result.current.state.status).toBe("ready");
    expect(result.current.canSignOut).toBe(true);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toHaveProperty(
      "nativeViewer",
    );
  });

  it("shares one pending Clerk sign-out across concurrent callers", async () => {
    const rejectSignOuts: ((error: unknown) => void)[] = [];
    clerkSignOut.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSignOuts.push(reject);
        }),
    );
    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let firstOperation: Promise<NativeSignOutResult> | undefined;
    let secondOperation: Promise<NativeSignOutResult> | undefined;

    act(() => {
      firstOperation = result.current.signOut();
      secondOperation = result.current.signOut();
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });

    const clerkCallCount = clerkSignOut.mock.calls.length;
    await act(async () => {
      for (const rejectSignOut of rejectSignOuts) {
        rejectSignOut(
          new Error("tokenIdentifier=private issuer=https://issuer.example"),
        );
      }
      await Promise.all([firstOperation, secondOperation]);
    });

    expect(clerkCallCount).toBe(1);
    await expect(firstOperation).resolves.toEqual({
      message: "We couldn't sign you out. Please try again.",
      ok: false,
    });
    await expect(secondOperation).resolves.toEqual({
      message: "We couldn't sign you out. Please try again.",
      ok: false,
    });
    expect(result.current.state.status).toBe("ready");
  });

  it("sanitizes sign-out failures and restores the still-current account", async () => {
    clerkSignOut.mockRejectedValue(
      new Error(
        "tokenIdentifier=https://issuer.example|user-a issuer=https://issuer.example",
      ),
    );
    const { result } = renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let signOutResult: NativeSignOutResult | undefined;

    await act(async () => {
      signOutResult = await result.current.signOut();
    });

    expect(signOutResult).toEqual({
      message: "We couldn't sign you out. Please try again.",
      ok: false,
    });
    expect(JSON.stringify(signOutResult)).not.toContain("tokenIdentifier");
    expect(JSON.stringify(signOutResult)).not.toContain("issuer.example");
    expect(result.current.state.status).toBe("ready");
  });
});
