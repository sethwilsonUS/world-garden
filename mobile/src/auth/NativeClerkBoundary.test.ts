import { renderHook } from "@testing-library/react-native";

import {
  useNativeClerkAuthFrom,
  useNativeClerkSessionFrom,
  useNativeClerkUserFrom,
  type NativeClerkAuth,
  type NativeClerkHookSource,
  type NativeClerkSession,
  type NativeClerkUser,
} from "./NativeClerkBoundary";

// The native SDK bootstraps process-level resources when Jest loads it. These
// fail-closed stubs keep that runtime out of this unit; every behavior below is
// exercised through the owned structural hook source instead.
jest.mock("@clerk/expo", () => ({
  useAuth: () => {
    throw new Error("Unexpected production Clerk auth hook in boundary unit");
  },
  useSession: () => {
    throw new Error(
      "Unexpected production Clerk session hook in boundary unit",
    );
  },
  useUser: () => {
    throw new Error("Unexpected production Clerk user hook in boundary unit");
  },
}));

const signOut = jest.fn<Promise<void>, []>();
const getToken = jest.fn<Promise<string | null>, []>();
const sessionResource = {
  getToken,
  id: "session-a",
  user: { id: "user-a" },
};

interface ClerkBoundaryState {
  readonly auth: NativeClerkAuth;
  readonly session: NativeClerkSession;
  readonly user: NativeClerkUser;
}

function createHookSource(state: ClerkBoundaryState) {
  const useAuth = jest.fn(() => state.auth);
  const source = {
    useAuth,
    useSession: jest.fn(() => state.session),
    useUser: jest.fn(() => state.user),
  } satisfies NativeClerkHookSource;

  return { source, useAuth };
}

const loadingState: ClerkBoundaryState = {
  auth: {
    isLoaded: false,
    isSignedIn: undefined,
    sessionId: undefined,
    signOut,
    userId: undefined,
  },
  session: {
    isLoaded: false,
    isSignedIn: undefined,
    session: undefined,
  },
  user: { isLoaded: false, isSignedIn: undefined, user: undefined },
};

const signedOutState: ClerkBoundaryState = {
  auth: {
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut,
    userId: null,
  },
  session: { isLoaded: true, isSignedIn: false, session: null },
  user: { isLoaded: true, isSignedIn: false, user: null },
};

const signedInState: ClerkBoundaryState = {
  auth: {
    isLoaded: true,
    isSignedIn: true,
    sessionId: "session-a",
    signOut,
    userId: "user-a",
  },
  session: { isLoaded: true, isSignedIn: true, session: sessionResource },
  user: { isLoaded: true, isSignedIn: true, user: { id: "user-a" } },
};

beforeEach(() => {
  jest.clearAllMocks();
  signOut.mockResolvedValue(undefined);
  getToken.mockResolvedValue("session-token");
});

describe("NativeClerkBoundary", () => {
  it("keeps pending sessions visible to the native auth bridge", async () => {
    const { source, useAuth } = createHookSource(loadingState);

    await renderHook(() => useNativeClerkAuthFrom(source));

    expect(useAuth).toHaveBeenCalledTimes(1);
    expect(useAuth).toHaveBeenCalledWith({ treatPendingAsSignedOut: false });
  });

  it.each([
    ["loading", loadingState],
    ["signed out", signedOutState],
    ["signed in", signedInState],
  ])("translates %s Clerk hook results", async (_label, state) => {
    const { source } = createHookSource(state);

    const { result } = await renderHook(() => ({
      auth: useNativeClerkAuthFrom(source),
      session: useNativeClerkSessionFrom(source),
      user: useNativeClerkUserFrom(source),
    }));

    expect(result.current).toEqual(state);
  });

  it("preserves projected hook identities across unchanged rerenders", async () => {
    const { source } = createHookSource(signedInState);
    const { result, rerender } = await renderHook(() => ({
      auth: useNativeClerkAuthFrom(source),
      session: useNativeClerkSessionFrom(source),
      user: useNativeClerkUserFrom(source),
    }));
    const firstProjection = result.current;

    await rerender({});

    expect(result.current.auth).toBe(firstProjection.auth);
    expect(result.current.session).toBe(firstProjection.session);
    expect(result.current.user).toBe(firstProjection.user);
  });
});
