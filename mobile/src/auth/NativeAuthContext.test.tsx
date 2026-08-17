import { useAuth, useSession, useUser } from "@clerk/expo";
import { act, renderHook } from "@testing-library/react-native";
import { useConvexAuth, useQueries } from "convex/react";
import * as React from "react";
import type { PropsWithChildren } from "react";

import {
  NativeAuthProvider,
  useNativeAuth,
  type NativeSignOutResult,
} from "./NativeAuthContext";
import { useNativeAuthTransportBinding } from "./NativeAuthTransportBindingContext";

jest.mock("@clerk/expo", () => ({
  useAuth: jest.fn(),
  useSession: jest.fn(),
  useUser: jest.fn(),
}));

jest.mock("convex/react", () => ({
  useConvexAuth: jest.fn(),
  useQueries: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const useSessionMock = jest.mocked(useSession);
const useUserMock = jest.mocked(useUser);
const useConvexAuthMock = jest.mocked(useConvexAuth);
const useQueriesMock = useQueries as jest.Mock;
const clerkSignOut = jest.fn<Promise<void>, []>();
const clerkGetToken = jest.fn<
  Promise<string | null>,
  [options?: { readonly skipCache?: boolean }]
>();
const clerkAuthGetToken = jest.fn<
  Promise<string | null>,
  [options?: { readonly skipCache?: boolean }]
>();

type ClerkAuth = ReturnType<typeof useAuth>;
type ClerkSession = ReturnType<typeof useSession>;
type ClerkUser = ReturnType<typeof useUser>;
type ConvexAuth = ReturnType<typeof useConvexAuth>;

let clerkAuth: ClerkAuth;
let clerkUser: ClerkUser;
let convexAuth: ConvexAuth;
let viewer: unknown;
let clerkSessionOverride: ClerkSession | undefined;
const clerkSessionResources = new Map<
  string,
  NonNullable<ClerkSession["session"]>
>();

function base64Url(value: string): string {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function sessionToken(userId = "user-a", sessionId = "session-a"): string {
  return [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(JSON.stringify({ sid: sessionId, sub: userId })),
    base64Url("test-signature"),
  ].join(".");
}

const defaultSessionToken = sessionToken();

function sessionForAuth(auth: ClerkAuth): ClerkSession {
  if (!auth.isLoaded) {
    return {
      isLoaded: false,
      isSignedIn: undefined,
      session: undefined,
    } as ClerkSession;
  }
  if (!auth.isSignedIn) {
    return { isLoaded: true, isSignedIn: false, session: null } as ClerkSession;
  }

  const resourceKey = `${auth.sessionId}:${auth.userId}`;
  let session = clerkSessionResources.get(resourceKey);
  if (session === undefined) {
    session = {
      getToken: clerkGetToken,
      id: auth.sessionId,
      user: { id: auth.userId },
    } as unknown as NonNullable<ClerkSession["session"]>;
    clerkSessionResources.set(resourceKey, session);
  }

  return { isLoaded: true, isSignedIn: true, session } as ClerkSession;
}

function signedInAuth(userId = "user-a", sessionId = "session-a"): ClerkAuth {
  return {
    getToken: clerkAuthGetToken,
    isLoaded: true,
    isSignedIn: true,
    sessionId,
    signOut: clerkSignOut,
    userId,
  } as unknown as ClerkAuth;
}

function signedOutAuth(): ClerkAuth {
  return {
    getToken: clerkAuthGetToken,
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut: clerkSignOut,
    userId: null,
  } as unknown as ClerkAuth;
}

function loadingAuth(): ClerkAuth {
  return {
    getToken: clerkAuthGetToken,
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

function useAuthAndTransport() {
  return {
    auth: useNativeAuth(),
    transport: useNativeAuthTransportBinding(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clerkSessionResources.clear();
  clerkSessionOverride = undefined;
  clerkSignOut.mockResolvedValue(undefined);
  clerkGetToken.mockResolvedValue(defaultSessionToken);
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
  useSessionMock.mockImplementation(
    () => clerkSessionOverride ?? sessionForAuth(clerkAuth),
  );
  useUserMock.mockImplementation(() => clerkUser);
  useConvexAuthMock.mockImplementation(() => convexAuth);
  useQueriesMock.mockImplementation((queries: Record<string, unknown>) =>
    Object.hasOwn(queries, "nativeViewer") ? { nativeViewer: viewer } : {},
  );
});

describe("NativeAuthProvider", () => {
  it("fails clearly when the hook escapes its provider", async () => {
    await expect(renderHook(() => useNativeAuth())).rejects.toThrow(
      "useNativeAuth() must be used within NativeAuthProvider",
    );
  });

  it("keeps Clerk session credentials inside the private transport binding", async () => {
    const { result } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const accountEpoch = result.current.auth.sessionEpoch;

    await expect(
      result.current.transport.resolveRequestCredentials(),
    ).resolves.toEqual({
      accountEpoch,
      sessionToken: defaultSessionToken,
      status: "authenticated",
    });
    expect(clerkGetToken).toHaveBeenCalledWith();
    expect(clerkAuthGetToken).not.toHaveBeenCalled();
    expect(result.current.transport.accountEpoch).toBe(accountEpoch);
    expect(result.current.transport).not.toHaveProperty(
      "expectedAccountSubject",
    );
    expect(result.current.transport.isCurrentAccountEpoch(accountEpoch)).toBe(
      true,
    );
    expect(result.current.auth).not.toHaveProperty("sessionToken");
    expect(result.current.auth).not.toHaveProperty("getToken");
    expect(JSON.stringify(result.current.auth)).not.toContain(
      defaultSessionToken,
    );
  });

  it("requests exactly one forced Clerk refresh when the caller asks", async () => {
    const { result } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });

    await expect(
      result.current.transport.resolveRequestCredentials({
        forceRefresh: true,
      }),
    ).resolves.toMatchObject({ status: "authenticated" });

    expect(clerkGetToken).toHaveBeenCalledTimes(1);
    expect(clerkGetToken).toHaveBeenCalledWith({ skipCache: true });
  });

  it.each([
    ["another account", sessionToken("user-a", "session-b")],
    ["another session", sessionToken("user-b", "session-a")],
  ])("rejects a cached JWT for %s", async (_label, cachedToken) => {
    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    clerkGetToken.mockResolvedValue(cachedToken);
    const { result } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });

    await expect(
      result.current.transport.resolveRequestCredentials(),
    ).resolves.toEqual({ status: "unavailable" });
    expect(clerkGetToken).toHaveBeenCalledTimes(1);
    expect(clerkAuthGetToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current.auth)).not.toContain(cachedToken);
  });

  it("supersedes a binding when Clerk replaces the exact session resource", async () => {
    const firstSession = sessionForAuth(clerkAuth);
    clerkSessionOverride = firstSession;
    const { result, rerender } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const firstBinding = result.current.transport;

    clerkSessionOverride = {
      isLoaded: true,
      isSignedIn: true,
      session: {
        getToken: clerkGetToken,
        id: "session-a",
        user: { id: "user-a" },
      },
    } as unknown as ClerkSession;
    await rerender(undefined);

    await expect(firstBinding.resolveRequestCredentials()).resolves.toEqual({
      status: "superseded",
    });
    expect(clerkGetToken).not.toHaveBeenCalled();
  });

  it("returns tokenless public credentials only for the current signed-out epoch", async () => {
    clerkAuth = signedOutAuth();
    clerkUser = {
      isLoaded: true,
      isSignedIn: false,
      user: null,
    } as ClerkUser;
    const { result } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const accountEpoch = result.current.auth.sessionEpoch;

    await expect(
      result.current.transport.resolveRequestCredentials(),
    ).resolves.toEqual({ accountEpoch, status: "public" });
    expect(clerkGetToken).not.toHaveBeenCalled();
  });

  it("does not let a stale signed-out binding mint credentials for a later account", async () => {
    clerkAuth = signedOutAuth();
    clerkUser = {
      isLoaded: true,
      isSignedIn: false,
      user: null,
    } as ClerkUser;
    const { result, rerender } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const signedOutBinding = result.current.transport;

    clerkAuth = signedInAuth();
    clerkUser = signedInUser();
    await rerender(undefined);

    await expect(signedOutBinding.resolveRequestCredentials()).resolves.toEqual(
      { status: "superseded" },
    );
    expect(clerkGetToken).not.toHaveBeenCalled();
  });

  it.each([
    ["Clerk is loading", "loading"],
    ["the account bridge is unavailable", "bridgeError"],
  ] as const)(
    "returns a sanitized unavailable result while %s",
    async (_label, expectedStatus) => {
      if (expectedStatus === "loading") {
        clerkAuth = loadingAuth();
      } else {
        convexAuth = {
          isAuthenticated: false,
          isLoading: false,
          isRefreshing: false,
        };
      }
      const { result } = await renderHook(() => useAuthAndTransport(), {
        wrapper: AuthWrapper,
      });

      expect(result.current.auth.state.status).toBe(expectedStatus);
      await expect(
        result.current.transport.resolveRequestCredentials(),
      ).resolves.toEqual({ status: "unavailable" });
      expect(clerkGetToken).not.toHaveBeenCalled();
    },
  );

  it("discards a token that resolves after the account epoch changes", async () => {
    let resolveToken: ((token: string | null) => void) | undefined;
    clerkGetToken.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const { result, rerender } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const firstBinding = result.current.transport;
    const firstEpoch = firstBinding.accountEpoch;
    const pendingCredentials = firstBinding.resolveRequestCredentials();

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    await rerender(undefined);

    await act(async () => {
      resolveToken?.("token-for-user-a");
      await pendingCredentials;
    });

    await expect(pendingCredentials).resolves.toEqual({
      status: "superseded",
    });
    expect(firstBinding.isCurrentAccountEpoch(firstEpoch)).toBe(false);
    expect(JSON.stringify(await pendingCredentials)).not.toContain(
      "token-for-user-a",
    );
  });

  it("discards a token that resolves after the auth provider unmounts", async () => {
    let resolveToken: ((token: string | null) => void) | undefined;
    clerkGetToken.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const { result, unmount } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const binding = result.current.transport;
    const pendingCredentials = binding.resolveRequestCredentials();

    await unmount();

    expect(binding.isCurrentAccountEpoch(binding.accountEpoch)).toBe(false);
    await act(async () => {
      resolveToken?.("token-from-unmounted-provider");
      await pendingCredentials;
    });
    await expect(pendingCredentials).resolves.toEqual({
      status: "superseded",
    });
    expect(JSON.stringify(await pendingCredentials)).not.toContain(
      "token-from-unmounted-provider",
    );
  });

  it("rotates the epoch and rejects stale credentials if a session is reused by another subject", async () => {
    let resolveToken: ((token: string | null) => void) | undefined;
    clerkGetToken.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const { result, rerender } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });
    const firstBinding = result.current.transport;
    const pendingCredentials = firstBinding.resolveRequestCredentials();

    clerkAuth = signedInAuth("user-b", "session-a");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    await rerender(undefined);

    expect(result.current.transport.accountEpoch).not.toBe(
      firstBinding.accountEpoch,
    );
    await act(async () => {
      resolveToken?.("token-for-user-a");
      await pendingCredentials;
    });
    await expect(pendingCredentials).resolves.toEqual({
      status: "superseded",
    });
  });

  it.each([
    ["Clerk rejects token access", new Error("private-token-in-error")],
    ["Clerk has no current token", null],
    ["Clerk returns an empty token", ""],
    ["Clerk returns a token with surrounding whitespace", " token-value "],
  ])("sanitizes credentials when %s", async (_label, tokenOrError) => {
    if (tokenOrError instanceof Error) {
      clerkGetToken.mockRejectedValue(tokenOrError);
    } else {
      clerkGetToken.mockResolvedValue(tokenOrError);
    }
    const { result } = await renderHook(() => useAuthAndTransport(), {
      wrapper: AuthWrapper,
    });

    const credentials =
      await result.current.transport.resolveRequestCredentials();

    expect(credentials).toEqual({ status: "unavailable" });
    expect(JSON.stringify(credentials)).not.toContain("private-token-in-error");
  });

  it.each([
    ["cached", undefined],
    ["forced-refresh", { forceRefresh: true }],
  ] as const)(
    "bounds a pending %s Clerk token lookup with a sanitized result",
    async (_label, options) => {
      jest.useFakeTimers();
      try {
        clerkGetToken.mockImplementation(
          () => new Promise<string | null>(() => undefined),
        );
        const { result } = await renderHook(() => useAuthAndTransport(), {
          wrapper: AuthWrapper,
        });

        const pendingCredentials =
          result.current.transport.resolveRequestCredentials(options);
        await act(async () => {
          await jest.advanceTimersByTimeAsync(15_000);
        });

        await expect(pendingCredentials).resolves.toEqual({
          status: "unavailable",
        });
        if (options?.forceRefresh) {
          expect(clerkGetToken).toHaveBeenCalledWith({ skipCache: true });
        } else {
          expect(clerkGetToken).toHaveBeenCalledWith();
        }
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it("preserves supersession when the account changes before token lookup times out", async () => {
    jest.useFakeTimers();
    try {
      clerkGetToken.mockImplementation(
        () => new Promise<string | null>(() => undefined),
      );
      const { result, rerender } = await renderHook(
        () => useAuthAndTransport(),
        {
          wrapper: AuthWrapper,
        },
      );
      const pendingCredentials =
        result.current.transport.resolveRequestCredentials();

      clerkAuth = signedInAuth("user-b", "session-b");
      clerkUser = signedInUser("user-b");
      viewer = {
        email: "sam@example.com",
        name: "Samwise Gamgee",
        subject: "user-b",
      };
      await rerender(undefined);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15_000);
      });

      await expect(pendingCredentials).resolves.toEqual({
        status: "superseded",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps Convex query-map identities stable across unrelated renders", async () => {
    const { rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const readyQueries = useQueriesMock.mock.calls.at(-1)?.[0];

    await rerender(undefined);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toBe(readyQueries);

    clerkAuth = signedOutAuth();
    await rerender(undefined);
    const skippedQueries = useQueriesMock.mock.calls.at(-1)?.[0];

    expect(skippedQueries).not.toBe(readyQueries);
    await rerender(undefined);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toBe(skippedQueries);
  });

  it("keeps one opaque epoch per Clerk session despite fresh hook wrappers", async () => {
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const firstEpoch = result.current.sessionEpoch;

    expect(typeof firstEpoch).toBe("symbol");

    clerkAuth = signedInAuth("user-a", "session-a");
    clerkUser = signedInUser("user-a");
    await rerender(undefined);

    expect(result.current.sessionEpoch).toBe(firstEpoch);

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    await rerender(undefined);
    const secondEpoch = result.current.sessionEpoch;

    expect(secondEpoch).not.toBe(firstEpoch);

    clerkAuth = signedOutAuth();
    clerkUser = signedInUser("user-b");
    await rerender(undefined);
    const signedOutEpoch = result.current.sessionEpoch;

    expect(signedOutEpoch).not.toBe(secondEpoch);

    clerkAuth = signedOutAuth();
    await rerender(undefined);

    expect(result.current.sessionEpoch).toBe(signedOutEpoch);
  });

  it("pairs each session epoch with a stable opaque serializable key", async () => {
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const firstEpoch = result.current.sessionEpoch;
    const firstEpochKey = result.current.sessionEpochKey;

    expect(typeof firstEpochKey).toBe("string");
    expect(firstEpochKey).not.toHaveLength(0);
    expect(firstEpochKey).not.toContain("session-a");
    expect(firstEpochKey).not.toContain("user-a");

    clerkAuth = signedInAuth("user-a", "session-a");
    clerkUser = signedInUser("user-a");
    await rerender(undefined);

    expect(result.current.sessionEpoch).toBe(firstEpoch);
    expect(result.current.sessionEpochKey).toBe(firstEpochKey);

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    await rerender(undefined);

    expect(result.current.sessionEpoch).not.toBe(firstEpoch);
    expect(result.current.sessionEpochKey).not.toBe(firstEpochKey);
    expect(result.current.sessionEpochKey).not.toContain("session-b");
    expect(result.current.sessionEpochKey).not.toContain("user-b");
    expect(JSON.parse(JSON.stringify(result.current.sessionEpochKey))).toBe(
      result.current.sessionEpochKey,
    );
  });

  it("keeps the session epoch stable when React discards memoized values", async () => {
    const useMemoSpy = jest
      .spyOn(React, "useMemo")
      .mockImplementation((factory) => factory());

    try {
      const { result, rerender } = await renderHook(() => useNativeAuth(), {
        wrapper: AuthWrapper,
      });
      const firstEpoch = result.current.sessionEpoch;
      const firstEpochKey = result.current.sessionEpochKey;

      clerkAuth = signedInAuth("user-a", "session-a");
      clerkUser = signedInUser("user-a");
      await rerender(undefined);

      expect(result.current.sessionEpoch).toBe(firstEpoch);
      expect(result.current.sessionEpochKey).toBe(firstEpochKey);
    } finally {
      useMemoSpy.mockRestore();
    }
  });

  it("keeps pending Clerk sessions loading and skips the private viewer query", async () => {
    clerkAuth = loadingAuth();

    const { result } = await renderHook(() => useNativeAuth(), {
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

  it("preserves a signed-out public client while hiding stale private identity", async () => {
    clerkAuth = signedOutAuth();
    clerkUser = signedInUser("user-a");
    viewer = {
      email: "ada@example.com",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    const { result } = await renderHook(() => useNativeAuth(), {
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
  ] as const)("stays connecting while %s", async (_label, nextConvexAuth) => {
    convexAuth = nextConvexAuth;

    const { result } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "connecting",
    });
    expect(result.current.canSignOut).toBe(true);
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});
  });

  it("stays connecting until the authenticated viewer query resolves", async () => {
    viewer = undefined;

    const { result } = await renderHook(() => useNativeAuth(), {
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
    async (_label, nextViewer, isAuthenticated) => {
      convexAuth = {
        isAuthenticated,
        isLoading: false,
        isRefreshing: false,
      };
      viewer = nextViewer;

      const { result } = await renderHook(() => useNativeAuth(), {
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

  it("fails closed with a generic bridge error when the viewer query fails", async () => {
    viewer = new Error(
      "tokenIdentifier=https://issuer.example|user-a backend unavailable",
    );

    const { result } = await renderHook(() => useNativeAuth(), {
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

  it("keeps the viewer subject internal after exact account matching", async () => {
    viewer = {
      email: "ada@example.com",
      issuer: "https://issuer.example",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    const { result } = await renderHook(() => useNativeAuth(), {
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
    expect(result.current).not.toHaveProperty("validatedAccountSubject");
  });

  it("removes the previous profile synchronously across an account switch", async () => {
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    expect(result.current.state.status).toBe("ready");

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    await rerender(undefined);

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
    await rerender(undefined);

    expect(result.current.state).toEqual({
      profile: {
        email: "sam@example.com",
        name: "Samwise Gamgee",
      },
      status: "ready",
    });
    expect(result.current.state.profile).not.toHaveProperty("subject");
  });

  it("removes the previous profile synchronously when Clerk signs out", async () => {
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    expect(result.current.state.status).toBe("ready");

    clerkAuth = signedOutAuth();
    await rerender(undefined);

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
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    const signedInEpoch = result.current.sessionEpoch;
    let operation: Promise<NativeSignOutResult> | undefined;

    await act(() => {
      operation = result.current.signOut();
    });

    expect(result.current.state).toEqual({
      profile: null,
      status: "signedOut",
    });
    expect(result.current.canSignOut).toBe(false);
    const suppressedEpoch = result.current.sessionEpoch;
    expect(suppressedEpoch).not.toBe(signedInEpoch);

    clerkAuth = signedOutAuth();
    await rerender(undefined);
    expect(result.current.sessionEpoch).toBe(suppressedEpoch);

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
    const { result, rerender } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let operation: Promise<NativeSignOutResult> | undefined;

    await act(() => {
      operation = result.current.signOut();
    });
    clerkAuth = signedOutAuth();
    await rerender(undefined);

    await act(async () => {
      resolveSignOut?.();
      await operation;
    });

    clerkAuth = signedInAuth("user-a", "session-a");
    clerkUser = signedInUser("user-a");
    await rerender(undefined);

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
    const { result } = await renderHook(() => useNativeAuth(), {
      wrapper: AuthWrapper,
    });
    let firstOperation: Promise<NativeSignOutResult> | undefined;
    let secondOperation: Promise<NativeSignOutResult> | undefined;

    await act(() => {
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
    const { result } = await renderHook(() => useNativeAuth(), {
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
