import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMutation } from "convex/react";
import type { PropsWithChildren } from "react";

import { useNativeAuth } from "../auth/NativeAuthContext";
import { useNativeAccountSubjectBinding } from "../auth/NativeAccountSubjectBindingContext";
import { useNativeListeningProgress } from "../listening/NativeListeningProgressContext";
import { ConvexNativeListeningProgressProvider } from "./ConvexNativeListeningProgressProvider";
import { useNativeListeningProgressQueryClient } from "./NativeListeningProgressQueryBoundary";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
}));

jest.mock("./NativeListeningProgressQueryBoundary", () => ({
  useNativeListeningProgressQueryClient: jest.fn(),
}));

jest.mock("../auth/NativeAuthContext", () => ({
  useNativeAuth: jest.fn(),
}));

jest.mock("../auth/NativeAccountSubjectBindingContext", () => ({
  useNativeAccountSubjectBinding: jest.fn(),
}));

const useMutationMock = useMutation as jest.Mock;
const useQueryClientMock = jest.mocked(
  useNativeListeningProgressQueryClient,
);
const useNativeAuthMock = jest.mocked(useNativeAuth);
const useNativeAccountSubjectBindingMock = jest.mocked(
  useNativeAccountSubjectBinding,
);
const query = jest.fn();
const writeMutation = jest.fn();
const signedOutEpoch = Symbol("signed-out");
const accountAEpoch = Symbol("account-a");
const accountBEpoch = Symbol("account-b");
const target = Object.freeze({
  narrationVersion: 2,
  revisionId: "1234",
  wikiPageId: "736",
});
const cursor = Object.freeze({
  ...target,
  durationSeconds: 120,
  mode: "all" as const,
  positionSeconds: 42,
  sectionKey: "section-1" as const,
});

function Wrapper({ children }: PropsWithChildren) {
  return (
    <ConvexNativeListeningProgressProvider>
      {children}
    </ConvexNativeListeningProgressProvider>
  );
}

function readyAuth(
  sessionEpoch = accountAEpoch,
  sessionEpochKey = "native-epoch-a",
): ReturnType<typeof useNativeAuth> {
  return {
    canSignOut: true,
    sessionEpoch,
    sessionEpochKey,
    signOut: jest.fn(),
    state: {
      profile: { email: "ada@example.com", name: "Ada Lovelace" },
      status: "ready",
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useQueryClientMock.mockReturnValue({ getNative: query });
  useMutationMock.mockReturnValue(writeMutation);
  useNativeAccountSubjectBindingMock.mockReturnValue(null);
  useNativeAuthMock.mockReturnValue({
    canSignOut: false,
    sessionEpoch: signedOutEpoch,
    sessionEpochKey: "native-epoch-signed-out",
    signOut: jest.fn(),
    state: { profile: null, status: "signedOut" },
  });
});

describe("ConvexNativeListeningProgressProvider", () => {
  it("keeps account progress unavailable and performs no private query while signed out", async () => {
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    expect(result.current.accountEpoch).toBe(signedOutEpoch);
    expect(result.current.availability).toBe("unavailable");
    await expect(
      result.current.openArticle({
        narrationVersion: 2,
        revisionId: "1234",
        wikiPageId: "736",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(query).not.toHaveBeenCalled();
    expect(writeMutation).not.toHaveBeenCalled();
  });

  it("reports connecting without issuing a private query while account binding settles", async () => {
    const accountEpoch = Symbol("connecting");
    useNativeAuthMock.mockReturnValue({
      canSignOut: false,
      sessionEpoch: accountEpoch,
      sessionEpochKey: "native-epoch-connecting",
      signOut: jest.fn(),
      state: { profile: null, status: "connecting" },
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    expect(result.current.availability).toBe("connecting");
    await expect(result.current.openArticle(target)).resolves.toEqual({
      status: "unavailable",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports connecting without querying while native auth is loading", async () => {
    const accountEpoch = Symbol("loading");
    useNativeAuthMock.mockReturnValue({
      canSignOut: false,
      sessionEpoch: accountEpoch,
      sessionEpochKey: "native-epoch-loading",
      signOut: jest.fn(),
      state: { profile: null, status: "loading" },
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    expect(result.current.availability).toBe("connecting");
    await expect(result.current.openArticle(target)).resolves.toEqual({
      status: "unavailable",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("opens one account-bound article session without exposing server metadata", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: { ...cursor, cursorVersion: 3, updatedAt: 1_786_000_000_000 },
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    expect(query).not.toHaveBeenCalled();
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");
    expect(opened).toEqual({
      cursor,
      session: expect.objectContaining({
        clear: expect.any(Function),
        save: expect.any(Function),
      }),
      status: "opened",
    });
    expect(Object.isFrozen(opened.cursor)).toBe(true);
    expect(opened.session).not.toHaveProperty("cursorVersion");
    expect(opened.session).not.toHaveProperty("expectedAccountSubject");
    expect(result.current.accountEpoch).toBe(accountAEpoch);
    expect(result.current.availability).toBe("ready");
    expect(query).toHaveBeenCalledWith(
      {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "native-epoch-a",
        wikiPageId: "736",
      },
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("projects the target fields from a structurally wider article cursor", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 0,
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    await expect(result.current.openArticle(cursor)).resolves.toMatchObject({
      cursor: null,
      status: "opened",
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ wikiPageId: "736" }),
    );
  });

  it.each([
    [
      "a live cursor at version zero",
      {
        cursor: { ...cursor, cursorVersion: 0, updatedAt: 1_786_000_000_000 },
        cursorVersion: 0,
        sessionEpochKey: "native-epoch-a",
      },
    ],
    [
      "an unexpected response field",
      {
        cursor: null,
        cursorVersion: 0,
        internalAccountSubject: "user-b",
        sessionEpochKey: "native-epoch-a",
      },
    ],
    [
      "a cursor bound to a different article revision",
      {
        cursor: {
          ...cursor,
          cursorVersion: 3,
          revisionId: "9999",
          updatedAt: 1_786_000_000_000,
        },
        cursorVersion: 3,
        sessionEpochKey: "native-epoch-a",
      },
    ],
  ])("fails closed on %s", async (_label, response) => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue(response);
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    await expect(result.current.openArticle(target)).resolves.toEqual({
      message: "We couldn’t load your saved position. Please try again.",
      status: "failed",
    });
  });

  it("sanitizes malformed targets and private query failures", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.openArticle({
        narrationVersion: 2,
        get revisionId(): string {
          throw new Error("private target details");
        },
        wikiPageId: "736",
      }),
    ).resolves.toEqual({
      message: "We couldn’t load your saved position. Please try again.",
      status: "failed",
    });
    expect(query).not.toHaveBeenCalled();

    query.mockRejectedValueOnce(
      new Error("tokenIdentifier=secret subject=user-a"),
    );
    await expect(result.current.openArticle(target)).resolves.toEqual({
      message: "We couldn’t load your saved position. Please try again.",
      status: "failed",
    });
  });

  it("supersedes a query response with the wrong echoed epoch", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 0,
      sessionEpochKey: "native-epoch-b",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });

    await expect(result.current.openArticle(target)).resolves.toEqual({
      status: "superseded",
    });
  });

  it("supersedes a callback retained across an account switch without querying the new account", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const staleOpenArticle = result.current.openArticle;

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});

    await expect(staleOpenArticle(target)).resolves.toEqual({
      status: "superseded",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("opens the new account after superseding a retained old-account callback", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const staleOpenArticle = result.current.openArticle;

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 0,
      sessionEpochKey: "native-epoch-b",
    });
    await rerender({});

    await expect(staleOpenArticle(target)).resolves.toEqual({
      status: "superseded",
    });
    await expect(result.current.openArticle(target)).resolves.toMatchObject({
      cursor: null,
      status: "opened",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAccountSubject: "user-b",
        sessionEpochKey: "native-epoch-b",
      }),
    );
  });

  it("supersedes a pending open after an account switch without exposing the old cursor", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    let resolveQuery: ((value: unknown) => void) | undefined;
    query.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const pendingOpen = result.current.openArticle(target);

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});
    await act(async () => {
      resolveQuery?.({
        cursor: { ...cursor, cursorVersion: 3, updatedAt: 1_786_000_000_000 },
        cursorVersion: 3,
        sessionEpochKey: "native-epoch-a",
      });
      await pendingOpen;
    });

    await expect(pendingOpen).resolves.toEqual({ status: "superseded" });
  });

  it("supersedes a pending open after provider teardown", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    let resolveQuery: ((value: unknown) => void) | undefined;
    query.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    const { result, unmount } = await renderHook(
      () => useNativeListeningProgress(),
      {
        wrapper: Wrapper,
      },
    );
    const pendingOpen = result.current.openArticle(target);

    await unmount();
    resolveQuery?.({
      cursor: { ...cursor, cursorVersion: 3, updatedAt: 1_786_000_000_000 },
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });

    await expect(pendingOpen).resolves.toEqual({ status: "superseded" });
  });

  it("commits a normalized cursor with the version observed when the session opened", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const savedCursor = Object.freeze({ ...cursor, positionSeconds: 58 });
    writeMutation.mockResolvedValue({
      cursor: {
        ...savedCursor,
        cursorVersion: 4,
        updatedAt: 1_786_000_000_001,
      },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(savedCursor)).resolves.toEqual({
      status: "committed",
    });
    expect(writeMutation).toHaveBeenCalledTimes(1);
    expect(writeMutation).toHaveBeenCalledWith({
      cursor: savedCursor,
      expectedAccountSubject: "user-a",
      expectedCursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
      wikiPageId: "736",
    });
  });

  it("serializes a save and clear while advancing the private cursor version", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    let resolveSave: ((value: unknown) => void) | undefined;
    writeMutation
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      )
      .mockResolvedValueOnce({
        cursor: null,
        cursorVersion: 5,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    const save = opened.session.save(cursor);
    const clear = opened.session.clear();
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    resolveSave?.({
      cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });
    await expect(save).resolves.toEqual({ status: "committed" });
    await expect(clear).resolves.toEqual({ status: "committed" });
    expect(writeMutation).toHaveBeenNthCalledWith(2, {
      cursor: null,
      expectedAccountSubject: "user-a",
      expectedCursorVersion: 4,
      sessionEpochKey: "native-epoch-a",
      wikiPageId: "736",
    });
  });

  it("coalesces consecutive pending saves while preserving clear as an ordering barrier", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const firstCursor = Object.freeze({ ...cursor, positionSeconds: 10 });
    const replacedBeforeClear = Object.freeze({
      ...cursor,
      positionSeconds: 20,
    });
    const latestBeforeClear = Object.freeze({
      ...cursor,
      positionSeconds: 30,
    });
    const replacedAfterClear = Object.freeze({
      ...cursor,
      positionSeconds: 40,
    });
    const latestAfterClear = Object.freeze({
      ...cursor,
      positionSeconds: 50,
    });
    let resolveFirst: ((value: unknown) => void) | undefined;
    writeMutation
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        cursor: {
          ...latestBeforeClear,
          cursorVersion: 5,
          updatedAt: 1_786_000_000_002,
        },
        cursorVersion: 5,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: null,
        cursorVersion: 6,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: {
          ...latestAfterClear,
          cursorVersion: 7,
          updatedAt: 1_786_000_000_004,
        },
        cursorVersion: 7,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    const first = opened.session.save(firstCursor);
    const replacedBefore = opened.session.save(replacedBeforeClear);
    const latestBefore = opened.session.save(latestBeforeClear);
    const clear = opened.session.clear();
    const replacedAfter = opened.session.save(replacedAfterClear);
    const latestAfter = opened.session.save(latestAfterClear);
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    resolveFirst?.({
      cursor: {
        ...firstCursor,
        cursorVersion: 4,
        updatedAt: 1_786_000_000_001,
      },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });

    await expect(first).resolves.toEqual({ status: "committed" });
    await expect(replacedBefore).resolves.toEqual({ status: "superseded" });
    await expect(latestBefore).resolves.toEqual({ status: "committed" });
    await expect(clear).resolves.toEqual({ status: "committed" });
    await expect(replacedAfter).resolves.toEqual({ status: "superseded" });
    await expect(latestAfter).resolves.toEqual({ status: "committed" });
    expect(writeMutation).toHaveBeenCalledTimes(4);
    expect(writeMutation.mock.calls[1]?.[0].cursor).toEqual(latestBeforeClear);
    expect(writeMutation.mock.calls[2]?.[0].cursor).toBeNull();
    expect(writeMutation.mock.calls[3]?.[0].cursor).toEqual(latestAfterClear);
    expect(
      writeMutation.mock.calls.map(([args]) => args.expectedCursorVersion),
    ).toEqual([3, 4, 5, 6]);
  });

  it("bounds queued clear barriers while a mutation is active", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    let resolveActive: ((value: unknown) => void) | undefined;
    writeMutation
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveActive = resolve;
        }),
      )
      .mockImplementation((args) =>
        Promise.resolve({
          cursor: null,
          cursorVersion: args.expectedCursorVersion + 1,
          disposition: "applied",
          sessionEpochKey: "native-epoch-a",
        }),
      );
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    void opened.session.save(cursor);
    const queuedClears = Array.from({ length: 32 }, () =>
      opened.session.clear(),
    );
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    await expect(opened.session.clear()).resolves.toEqual({
      message: "We couldn’t update your saved position. Please try again.",
      status: "failed",
    });
    resolveActive?.({
      cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });
    await expect(Promise.all(queuedClears)).resolves.toEqual(
      Array.from({ length: 32 }, () => ({ status: "committed" })),
    );
    expect(writeMutation).toHaveBeenCalledTimes(33);
  });

  it("supersedes a stale clear before applying queue capacity", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    void opened.session.save(cursor);
    Array.from({ length: 32 }, () => void opened.session.clear());
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});

    await expect(opened.session.clear()).resolves.toEqual({
      status: "superseded",
    });
  });

  it("converges a stale identical retry and uses the returned version next", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 5, updatedAt: 1_786_000_000_001 },
        cursorVersion: 5,
        disposition: "stale",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: null,
        cursorVersion: 6,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    await expect(opened.session.clear()).resolves.toEqual({
      status: "committed",
    });
    expect(writeMutation.mock.calls[1]?.[0].expectedCursorVersion).toBe(5);
  });

  it("converges a stale cleared cursor and uses the returned version next", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: { ...cursor, cursorVersion: 3, updatedAt: 1_786_000_000_000 },
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation
      .mockResolvedValueOnce({
        cursor: null,
        cursorVersion: 5,
        disposition: "stale",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 6, updatedAt: 1_786_000_000_002 },
        cursorVersion: 6,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.clear()).resolves.toEqual({
      status: "committed",
    });
    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    expect(writeMutation.mock.calls[1]?.[0].expectedCursorVersion).toBe(5);
  });

  it("returns and freezes a stale-different conflict without further writes", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const otherCursor = Object.freeze({ ...cursor, positionSeconds: 75 });
    writeMutation.mockResolvedValue({
      cursor: {
        ...otherCursor,
        cursorVersion: 5,
        updatedAt: 1_786_000_000_001,
      },
      cursorVersion: 5,
      disposition: "stale",
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    const conflict = await opened.session.save(cursor);
    expect(conflict).toEqual({
      cursor: otherCursor,
      status: "conflict",
    });
    expect(Object.isFrozen(conflict)).toBe(true);
    if (conflict.status !== "conflict") throw new Error("Expected conflict");
    expect(Object.isFrozen(conflict.cursor)).toBe(true);
    await expect(opened.session.clear()).resolves.toEqual({
      cursor: otherCursor,
      status: "conflict",
    });
    await expect(
      opened.session.save({ ...cursor, revisionId: "9999" }),
    ).resolves.toEqual({
      cursor: otherCursor,
      status: "conflict",
    });
    expect(writeMutation).toHaveBeenCalledTimes(1);
  });

  it("supersedes an old account conflict before returning its private cursor", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const otherCursor = Object.freeze({ ...cursor, positionSeconds: 75 });
    writeMutation.mockResolvedValue({
      cursor: {
        ...otherCursor,
        cursorVersion: 5,
        updatedAt: 1_786_000_000_001,
      },
      cursorVersion: 5,
      disposition: "stale",
      sessionEpochKey: "native-epoch-a",
    });
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");
    await expect(opened.session.save(cursor)).resolves.toEqual({
      cursor: otherCursor,
      status: "conflict",
    });

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});

    await expect(opened.session.clear()).resolves.toEqual({
      status: "superseded",
    });
  });

  it("writes a first cursor from version zero", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 0,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation.mockResolvedValue({
      cursor: { ...cursor, cursorVersion: 1, updatedAt: 1_786_000_000_001 },
      cursorVersion: 1,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    expect(writeMutation).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCursorVersion: 0 }),
    );
  });

  it("supersedes an active and queued write after an account switch", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    let resolveWrite: ((value: unknown) => void) | undefined;
    writeMutation.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");
    const save = opened.session.save(cursor);
    const clear = opened.session.clear();
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});
    resolveWrite?.({
      cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });

    await expect(save).resolves.toEqual({ status: "superseded" });
    await expect(clear).resolves.toEqual({ status: "superseded" });
    expect(writeMutation).toHaveBeenCalledTimes(1);
  });

  it("supersedes an active and queued write after provider teardown", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    let resolveWrite: ((value: unknown) => void) | undefined;
    writeMutation.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const { result, unmount } = await renderHook(
      () => useNativeListeningProgress(),
      {
        wrapper: Wrapper,
      },
    );
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");
    const save = opened.session.save(cursor);
    const clear = opened.session.clear();
    await waitFor(() => expect(writeMutation).toHaveBeenCalledTimes(1));

    await unmount();
    resolveWrite?.({
      cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-a",
    });

    await expect(save).resolves.toEqual({ status: "superseded" });
    await expect(clear).resolves.toEqual({ status: "superseded" });
    expect(writeMutation).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed write retryable at the same observed version with sanitized errors", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation
      .mockRejectedValueOnce(new Error("tokenIdentifier=secret subject=user-a"))
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
        cursorVersion: 4,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      message: "We couldn’t update your saved position. Please try again.",
      status: "failed",
    });
    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    expect(
      writeMutation.mock.calls.map(([args]) => args.expectedCursorVersion),
    ).toEqual([3, 3]);
  });

  it("fails a mismatched save without sending it to Convex", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(
      opened.session.save({ ...cursor, revisionId: "9999" }),
    ).resolves.toEqual({
      message: "We couldn’t update your saved position. Please try again.",
      status: "failed",
    });
    expect(writeMutation).not.toHaveBeenCalled();
  });

  it("supersedes even a malformed save retained across an account switch", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const { result, rerender } = await renderHook(
      () => useNativeListeningProgress(),
      { wrapper: Wrapper },
    );
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    useNativeAuthMock.mockReturnValue(
      readyAuth(accountBEpoch, "native-epoch-b"),
    );
    useNativeAccountSubjectBindingMock.mockReturnValue("user-b");
    await rerender({});

    await expect(
      opened.session.save({ ...cursor, revisionId: "9999" }),
    ).resolves.toEqual({ status: "superseded" });
    expect(writeMutation).not.toHaveBeenCalled();
  });

  it("rejects malformed applied metadata without advancing the retry version", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 6, updatedAt: 1_786_000_000_001 },
        cursorVersion: 6,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_002 },
        cursorVersion: 4,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      message: "We couldn’t update your saved position. Please try again.",
      status: "failed",
    });
    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    expect(
      writeMutation.mock.calls.map(([args]) => args.expectedCursorVersion),
    ).toEqual([3, 3]);
  });

  it("rejects an applied response that echoes a different cursor intent", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    const otherCursor = Object.freeze({ ...cursor, positionSeconds: 75 });
    writeMutation
      .mockResolvedValueOnce({
        cursor: {
          ...otherCursor,
          cursorVersion: 4,
          updatedAt: 1_786_000_000_001,
        },
        cursorVersion: 4,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      })
      .mockResolvedValueOnce({
        cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_002 },
        cursorVersion: 4,
        disposition: "applied",
        sessionEpochKey: "native-epoch-a",
      });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      message: "We couldn’t update your saved position. Please try again.",
      status: "failed",
    });
    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "committed",
    });
    expect(
      writeMutation.mock.calls.map(([args]) => args.expectedCursorVersion),
    ).toEqual([3, 3]);
  });

  it("supersedes a mutation response with the wrong echoed epoch", async () => {
    useNativeAuthMock.mockReturnValue(readyAuth());
    useNativeAccountSubjectBindingMock.mockReturnValue("user-a");
    query.mockResolvedValue({
      cursor: null,
      cursorVersion: 3,
      sessionEpochKey: "native-epoch-a",
    });
    writeMutation.mockResolvedValue({
      cursor: { ...cursor, cursorVersion: 4, updatedAt: 1_786_000_000_001 },
      cursorVersion: 4,
      disposition: "applied",
      sessionEpochKey: "native-epoch-b",
    });
    const { result } = await renderHook(() => useNativeListeningProgress(), {
      wrapper: Wrapper,
    });
    const opened = await result.current.openArticle(target);
    if (opened.status !== "opened") throw new Error("Expected opened session");

    await expect(opened.session.save(cursor)).resolves.toEqual({
      status: "superseded",
    });
    await expect(opened.session.clear()).resolves.toEqual({
      status: "superseded",
    });
    expect(writeMutation).toHaveBeenCalledTimes(1);
  });
});
