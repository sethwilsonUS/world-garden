import { useAuth, useSession, useUser } from "@clerk/expo";
import { act, renderHook } from "@testing-library/react-native";
import { useConvexAuth, useMutation, useQueries } from "convex/react";
import { useEffect, type PropsWithChildren } from "react";

import { NativeAuthProvider } from "../auth/NativeAuthContext";
import { useNativeLibrary } from "../library/NativeLibraryContext";
import { ConvexNativeLibraryProvider } from "./ConvexNativeLibraryProvider";
import { convexClientApi } from "./convexClientApi";

jest.mock("@clerk/expo", () => ({
  useAuth: jest.fn(),
  useSession: jest.fn(),
  useUser: jest.fn(),
}));

jest.mock("convex/react", () => ({
  useConvexAuth: jest.fn(),
  useMutation: jest.fn(),
  useQueries: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const useSessionMock = jest.mocked(useSession);
const useUserMock = jest.mocked(useUser);
const useConvexAuthMock = jest.mocked(useConvexAuth);
const useMutationMock = useMutation as jest.Mock;
const useQueriesMock = useQueries as jest.Mock;
const clerkSignOut = jest.fn();
const saveBookmarkMutation = jest.fn();
const removeBookmarkMutation = jest.fn();

type ClerkAuth = ReturnType<typeof useAuth>;
type ClerkSession = ReturnType<typeof useSession>;
type ClerkUser = ReturnType<typeof useUser>;
type ConvexAuth = ReturnType<typeof useConvexAuth>;

let clerkAuth: ClerkAuth;
let clerkUser: ClerkUser;
let convexAuth: ConvexAuth;
let viewer: unknown;
let libraryQueryResult:
  | unknown
  | ((args: Readonly<{ sessionEpochKey: string }>) => unknown);
const clerkSessionResources = new Map<
  string,
  NonNullable<ClerkSession["session"]>
>();

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
      getToken: jest.fn(),
      id: auth.sessionId,
      user: { id: auth.userId },
    } as unknown as NonNullable<ClerkSession["session"]>;
    clerkSessionResources.set(resourceKey, session);
  }

  return { isLoaded: true, isSignedIn: true, session } as ClerkSession;
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

function signedInAuth(userId = "user-a", sessionId = "session-a"): ClerkAuth {
  return {
    isLoaded: true,
    isSignedIn: true,
    sessionId,
    signOut: clerkSignOut,
    userId,
  } as unknown as ClerkAuth;
}

function signedOutUser(): ClerkUser {
  return {
    isLoaded: true,
    isSignedIn: false,
    user: null,
  };
}

function signedInUser(userId = "user-a"): ClerkUser {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: { id: userId },
  } as ClerkUser;
}

function LibraryWrapper({ children }: PropsWithChildren) {
  return (
    <NativeAuthProvider>
      <ConvexNativeLibraryProvider>{children}</ConvexNativeLibraryProvider>
    </NativeAuthProvider>
  );
}

function findLibraryQuery(
  queries: Record<string, { args?: unknown; query?: unknown }>,
): [string, { args?: unknown; query?: unknown }] | undefined {
  return Object.entries(queries).find(
    ([, query]) => query.query === convexClientApi.bookmarks.listNative,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clerkSessionResources.clear();
  clerkAuth = signedOutAuth();
  clerkUser = signedOutUser();
  convexAuth = {
    isAuthenticated: false,
    isLoading: false,
    isRefreshing: false,
  };
  viewer = undefined;
  libraryQueryResult = undefined;

  useAuthMock.mockImplementation(() => clerkAuth);
  useSessionMock.mockImplementation(() => sessionForAuth(clerkAuth));
  useUserMock.mockImplementation(() => clerkUser);
  useConvexAuthMock.mockImplementation(() => convexAuth);
  useQueriesMock.mockImplementation(
    (queries: Record<string, { args?: unknown; query?: unknown }>) => {
      if (Object.hasOwn(queries, "nativeViewer")) {
        return { nativeViewer: viewer };
      }

      const libraryQuery = findLibraryQuery(queries);
      return libraryQuery === undefined
        ? {}
        : {
            [libraryQuery[0]]:
              typeof libraryQueryResult === "function"
                ? libraryQueryResult(
                    libraryQuery[1].args as Readonly<{
                      sessionEpochKey: string;
                    }>,
                  )
                : libraryQueryResult,
          };
    },
  );
  useMutationMock.mockImplementation((reference: unknown) =>
    reference === convexClientApi.bookmarks.saveNative
      ? saveBookmarkMutation
      : removeBookmarkMutation,
  );
});

describe("ConvexNativeLibraryProvider", () => {
  it("keeps account entries absent and skips the private query while signed out", async () => {
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });

    expect(result.current.state).toEqual({
      entries: [],
      status: "signedOut",
    });
    expect(
      useQueriesMock.mock.calls.some(([queries]) =>
        Boolean(findLibraryQuery(queries)),
      ),
    ).toBe(false);
  });

  it("supersedes account mutations while signed out", async () => {
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });

    await expect(
      result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      }),
    ).resolves.toEqual({ status: "superseded" });
    await expect(
      result.current.removeBookmark({ slug: "Ada_Lovelace" }),
    ).resolves.toEqual({ status: "superseded" });
    expect(saveBookmarkMutation).not.toHaveBeenCalled();
    expect(removeBookmarkMutation).not.toHaveBeenCalled();
  });

  it("keeps entries empty while the signed-in account bridge connects", async () => {
    clerkAuth = signedInAuth();
    clerkUser = signedInUser();
    convexAuth = {
      isAuthenticated: false,
      isLoading: true,
      isRefreshing: false,
    };

    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });

    expect(result.current.state).toEqual({
      entries: [],
      status: "connecting",
    });
    expect(
      useQueriesMock.mock.calls.some(([queries]) =>
        Boolean(findLibraryQuery(queries)),
      ),
    ).toBe(false);
  });

  it("binds the private query to the validated subject and opaque epoch", async () => {
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

    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    const libraryQuery = useQueriesMock.mock.calls
      .map(([queries]) => findLibraryQuery(queries))
      .find((query) => query !== undefined);

    expect(result.current.state).toEqual({ entries: [], status: "loading" });
    expect(libraryQuery?.[1]).toEqual({
      args: {
        expectedAccountSubject: "user-a",
        sessionEpochKey: expect.stringMatching(/^native-epoch-/),
      },
      query: convexClientApi.bookmarks.listNative,
    });
    expect(JSON.stringify(libraryQuery?.[1].args)).not.toContain("session-a");
  });

  it("reveals only entries echoed for the current account epoch", async () => {
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
    const entries = [
      {
        savedAt: 1_754_342_400_000,
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      },
    ];
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries,
      sessionEpochKey,
    });

    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });

    expect(result.current.state).toEqual({ entries, status: "ready" });
  });

  it("sanitizes query failures and retries without changing the account key", async () => {
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
    libraryQueryResult = new Error(
      "tokenIdentifier=https://issuer.example|user-a database unavailable",
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    const firstQuery = useQueriesMock.mock.calls
      .map(([queries]) => findLibraryQuery(queries))
      .find((query) => query !== undefined);

    expect(result.current.state).toEqual({
      entries: [],
      message: "We couldn’t load your Library. Please try again.",
      status: "error",
    });
    expect(JSON.stringify(result.current.state)).not.toContain(
      "tokenIdentifier",
    );
    expect(JSON.stringify(result.current.state)).not.toContain(
      "issuer.example",
    );

    const entries = [
      {
        savedAt: 1_754_342_400_000,
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      },
    ];
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries,
      sessionEpochKey,
    });
    const retryStartCallCount = useQueriesMock.mock.calls.length;
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    const retryCalls = useQueriesMock.mock.calls.slice(retryStartCallCount);
    const retriedQuery = useQueriesMock.mock.calls
      .map(([queries]) => findLibraryQuery(queries))
      .findLast((query) => query !== undefined);

    expect(
      retryCalls.some(([queries]) => Object.keys(queries).length === 0),
    ).toBe(true);
    expect(retriedQuery?.[0]).not.toBe(firstQuery?.[0]);
    expect(retriedQuery?.[1].args).toEqual(firstQuery?.[1].args);
    expect(result.current.state).toEqual({ entries, status: "ready" });
  });

  it("clears entries synchronously and ignores a stale query across accounts", async () => {
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
    const adaEntries = [
      {
        savedAt: 1_754_342_400_000,
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      },
    ];
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: adaEntries,
      sessionEpochKey,
    });
    const { result, rerender } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    const firstQuery = useQueriesMock.mock.calls
      .map(([queries]) => findLibraryQuery(queries))
      .find((query) => query !== undefined);
    const firstEpochKey = (
      firstQuery?.[1].args as Readonly<{ sessionEpochKey: string }>
    ).sessionEpochKey;
    expect(result.current.state).toEqual({
      entries: adaEntries,
      status: "ready",
    });

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    libraryQueryResult = {
      entries: adaEntries,
      sessionEpochKey: firstEpochKey,
    };
    await rerender(undefined);

    expect(result.current.state).toEqual({ entries: [], status: "loading" });
    expect(JSON.stringify(result.current.state)).not.toContain("Ada_Lovelace");
    const nextQuery = useQueriesMock.mock.calls
      .map(([queries]) => findLibraryQuery(queries))
      .findLast((query) => query !== undefined);
    expect(nextQuery?.[1].args).not.toEqual(firstQuery?.[1].args);

    const samEntries = [
      {
        savedAt: 1_754_428_800_000,
        slug: "Samwise_Gamgee",
        title: "Samwise Gamgee",
      },
    ];
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: samEntries,
      sessionEpochKey,
    });
    await rerender(undefined);

    expect(result.current.state).toEqual({
      entries: samEntries,
      status: "ready",
    });
  });

  it("preserves its child tree when the account epoch changes", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    const mounted = jest.fn();
    const unmounted = jest.fn();
    const { rerender } = await renderHook(
      () => {
        useEffect(() => {
          mounted();
          return unmounted;
        }, []);
        return useNativeLibrary();
      },
      { wrapper: LibraryWrapper },
    );

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    await rerender(undefined);

    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("commits a signed-in save and exposes only that slug as pending", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    let resolveSave: ((entry: unknown) => void) | undefined;
    saveBookmarkMutation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let operation: ReturnType<typeof result.current.saveBookmark> | undefined;

    await act(async () => {
      operation = result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      });
      await Promise.resolve();
    });

    expect(saveBookmarkMutation).toHaveBeenCalledWith({
      expectedAccountSubject: "user-a",
      sessionEpochKey: expect.stringMatching(/^native-epoch-/),
      slug: "Ada_Lovelace",
      title: "Ada Lovelace",
    });
    expect(result.current.isMutating("Ada_Lovelace")).toBe(true);
    expect(result.current.isMutating("Grace_Hopper")).toBe(false);

    await act(async () => {
      resolveSave?.({
        entry: {
          savedAt: 1_754_342_400_000,
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
        },
        sessionEpochKey:
          saveBookmarkMutation.mock.calls[0]?.[0].sessionEpochKey,
      });
      await operation;
    });

    await expect(operation).resolves.toEqual({ status: "committed" });
    expect(result.current.isMutating("Ada_Lovelace")).toBe(false);
  });

  it("commits a signed-in removal through the reviewed mutation", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [
        {
          savedAt: 1_754_342_400_000,
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
        },
      ],
      sessionEpochKey,
    });
    removeBookmarkMutation.mockImplementation(
      async (args: Readonly<{ sessionEpochKey: string }>) => ({
        removed: true,
        sessionEpochKey: args.sessionEpochKey,
      }),
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let mutationResult: unknown;

    await act(async () => {
      mutationResult = await result.current.removeBookmark({
        slug: "Ada_Lovelace",
      });
    });

    expect(removeBookmarkMutation).toHaveBeenCalledWith({
      expectedAccountSubject: "user-a",
      sessionEpochKey: expect.stringMatching(/^native-epoch-/),
      slug: "Ada_Lovelace",
    });
    expect(mutationResult).toEqual({ status: "committed" });
    expect(result.current.isMutating("Ada_Lovelace")).toBe(false);
  });

  it("deduplicates a repeated slug and supersedes a conflicting mutation", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    let resolveSave: ((entry: unknown) => void) | undefined;
    saveBookmarkMutation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let firstOperation:
      | ReturnType<typeof result.current.saveBookmark>
      | undefined;
    let repeatedOperation:
      | ReturnType<typeof result.current.saveBookmark>
      | undefined;
    let conflictingOperation:
      | ReturnType<typeof result.current.removeBookmark>
      | undefined;

    await act(async () => {
      firstOperation = result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      });
      repeatedOperation = result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      });
      conflictingOperation = result.current.removeBookmark({
        slug: "Ada_Lovelace",
      });
      await Promise.resolve();
    });

    expect(repeatedOperation).toBe(firstOperation);
    expect(saveBookmarkMutation).toHaveBeenCalledTimes(1);
    expect(removeBookmarkMutation).not.toHaveBeenCalled();
    await expect(conflictingOperation).resolves.toEqual({
      status: "superseded",
    });

    await act(async () => {
      resolveSave?.({
        entry: {
          savedAt: 1_754_342_400_000,
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
        },
        sessionEpochKey:
          saveBookmarkMutation.mock.calls[0]?.[0].sessionEpochKey,
      });
      await firstOperation;
    });
    await expect(firstOperation).resolves.toEqual({ status: "committed" });
  });

  it("sanitizes a save failure and releases its pending slug", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    saveBookmarkMutation.mockRejectedValue(
      new Error(
        "tokenIdentifier=https://issuer.example|user-a database unavailable",
      ),
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let mutationResult: unknown;

    await act(async () => {
      mutationResult = await result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      });
    });

    expect(mutationResult).toEqual({
      message: "We couldn’t save this article. Please try again.",
      status: "failed",
    });
    expect(JSON.stringify(mutationResult)).not.toContain("tokenIdentifier");
    expect(JSON.stringify(mutationResult)).not.toContain("issuer.example");
    expect(result.current.isMutating("Ada_Lovelace")).toBe(false);
    expect(result.current.state).toEqual({ entries: [], status: "ready" });
  });

  it("sanitizes a synchronous transport throw and releases its pending slug", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    saveBookmarkMutation.mockImplementation(() => {
      throw new Error("private synchronous transport failure");
    });
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let mutationResult: unknown;

    await act(async () => {
      mutationResult = await result.current.saveBookmark({
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
      });
    });

    expect(mutationResult).toEqual({
      message: "We couldn’t save this article. Please try again.",
      status: "failed",
    });
    expect(JSON.stringify(mutationResult)).not.toContain("private synchronous");
    expect(result.current.isMutating("Ada_Lovelace")).toBe(false);
  });

  it("sanitizes a removal failure", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [
        {
          savedAt: 1_754_342_400_000,
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
        },
      ],
      sessionEpochKey,
    });
    removeBookmarkMutation.mockRejectedValue(
      new Error("viewerTokenIdentifier=private database unavailable"),
    );
    const { result } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let mutationResult: unknown;

    await act(async () => {
      mutationResult = await result.current.removeBookmark({
        slug: "Ada_Lovelace",
      });
    });
    expect(mutationResult).toEqual({
      message: "We couldn’t remove this article. Please try again.",
      status: "failed",
    });
  });

  it("rejects a stale action callback after the account bridge becomes unavailable", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [
        {
          savedAt: 1_754_342_400_000,
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
        },
      ],
      sessionEpochKey,
    });
    const { result, rerender } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    const staleRemove = result.current.removeBookmark;

    convexAuth = {
      isAuthenticated: true,
      isLoading: false,
      isRefreshing: true,
    };
    await rerender(undefined);

    expect(result.current.state).toEqual({
      entries: [],
      status: "connecting",
    });
    await expect(staleRemove({ slug: "Ada_Lovelace" })).resolves.toEqual({
      status: "superseded",
    });
    expect(removeBookmarkMutation).not.toHaveBeenCalled();
  });

  it("supersedes a stale mutation without disturbing the next account", async () => {
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
    libraryQueryResult = ({
      sessionEpochKey,
    }: Readonly<{ sessionEpochKey: string }>) => ({
      entries: [],
      sessionEpochKey,
    });
    const resolveSaves: ((entry: unknown) => void)[] = [];
    saveBookmarkMutation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSaves.push(resolve);
        }),
    );
    const { result, rerender } = await renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });
    let oldAccountOperation:
      | ReturnType<typeof result.current.saveBookmark>
      | undefined;
    await act(async () => {
      oldAccountOperation = result.current.saveBookmark({
        slug: "The_Ring",
        title: "The Ring",
      });
      await Promise.resolve();
    });

    clerkAuth = signedInAuth("user-b", "session-b");
    clerkUser = signedInUser("user-b");
    viewer = {
      email: "sam@example.com",
      name: "Samwise Gamgee",
      subject: "user-b",
    };
    await rerender(undefined);

    expect(result.current.state).toEqual({ entries: [], status: "ready" });
    expect(result.current.isMutating("The_Ring")).toBe(false);

    let newAccountOperation:
      | ReturnType<typeof result.current.saveBookmark>
      | undefined;
    await act(async () => {
      newAccountOperation = result.current.saveBookmark({
        slug: "The_Ring",
        title: "A Different Ring",
      });
      await Promise.resolve();
    });
    expect(saveBookmarkMutation).toHaveBeenCalledTimes(2);
    expect(saveBookmarkMutation.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ expectedAccountSubject: "user-a" }),
    );
    expect(saveBookmarkMutation.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ expectedAccountSubject: "user-b" }),
    );
    expect(saveBookmarkMutation.mock.calls[0]?.[0].sessionEpochKey).not.toBe(
      saveBookmarkMutation.mock.calls[1]?.[0].sessionEpochKey,
    );
    expect(result.current.isMutating("The_Ring")).toBe(true);

    await act(async () => {
      resolveSaves[0]?.({
        entry: {
          savedAt: 1_754_342_400_000,
          slug: "The_Ring",
          title: "The Ring",
        },
        sessionEpochKey:
          saveBookmarkMutation.mock.calls[0]?.[0].sessionEpochKey,
      });
      await oldAccountOperation;
    });
    await expect(oldAccountOperation).resolves.toEqual({
      status: "superseded",
    });
    expect(result.current.isMutating("The_Ring")).toBe(true);

    await act(async () => {
      resolveSaves[1]?.({
        entry: {
          savedAt: 1_754_428_800_000,
          slug: "The_Ring",
          title: "A Different Ring",
        },
        sessionEpochKey:
          saveBookmarkMutation.mock.calls[1]?.[0].sessionEpochKey,
      });
      await newAccountOperation;
    });
    await expect(newAccountOperation).resolves.toEqual({
      status: "committed",
    });
    expect(result.current.isMutating("The_Ring")).toBe(false);
  });
});
