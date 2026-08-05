import { useAuth, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  ConvexReactClient,
  useAction,
  useConvexAuth,
  useMutation,
  useQueries,
} from "convex/react";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";

import { useNativeAuth } from "../auth/NativeAuthContext";
import { convexClientApi } from "../data/convexClientApi";
import { useWikipediaReader } from "../data/WikipediaReaderContext";
import { useNativeLibrary } from "../library/NativeLibraryContext";
import { NativeDataAuthProvider } from "./NativeDataAuthProvider";

const mockClerkProviderBoundary = jest.fn(({ children }: PropsWithChildren) => (
  <View testID="clerk-provider">{children}</View>
));
const mockConvexProviderBoundary = jest.fn(
  ({ children }: PropsWithChildren) => (
    <View testID="convex-provider">{children}</View>
  ),
);

jest.mock("@clerk/expo", () => ({
  ClerkProvider: (props: PropsWithChildren) => mockClerkProviderBoundary(props),
  useAuth: jest.fn(),
  useUser: jest.fn(),
}));

jest.mock("@clerk/expo/token-cache", () => ({
  tokenCache: Object.freeze({
    clearToken: jest.fn(),
    getToken: jest.fn(),
    saveToken: jest.fn(),
  }),
}));

jest.mock("convex/react", () => ({
  ConvexReactClient: jest
    .fn()
    .mockImplementation((convexUrl: string) => ({ convexUrl })),
  useAction: jest.fn(),
  useConvexAuth: jest.fn(),
  useMutation: jest.fn(),
  useQueries: jest.fn(),
}));

jest.mock("convex/react-clerk", () => ({
  ConvexProviderWithClerk: (props: PropsWithChildren) =>
    mockConvexProviderBoundary(props),
}));

const convexClientConstructor = ConvexReactClient as unknown as jest.Mock;
const useActionMock = useAction as jest.Mock;
const useAuthMock = jest.mocked(useAuth);
const useUserMock = jest.mocked(useUser);
const useConvexAuthMock = jest.mocked(useConvexAuth);
const useMutationMock = useMutation as jest.Mock;
const useQueriesMock = useQueries as jest.Mock;
const publicSearch = jest.fn();
const publicFetchArticle = jest.fn();
const clerkSignOut = jest.fn();

function PublicSignedOutConsumer() {
  const { state } = useNativeAuth();
  const library = useNativeLibrary();
  const reader = useWikipediaReader();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void reader.search({ term: "Ada" })}
      testID="public-reader-consumer"
    >
      <Text>{state.status}</Text>
      <Text testID="library-status">library:{library.state.status}</Text>
    </Pressable>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  publicSearch.mockResolvedValue([]);
  publicFetchArticle.mockResolvedValue({
    language: "en",
    narrationVersion: 2,
    revisionId: "1234",
    sections: [],
    title: "Ada Lovelace",
    wikiPageId: "736",
  });
  useActionMock.mockImplementation((reference: unknown) =>
    reference === convexClientApi.wikipedia.search
      ? publicSearch
      : publicFetchArticle,
  );
  useAuthMock.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut: clerkSignOut,
    userId: null,
  } as unknown as ReturnType<typeof useAuth>);
  useUserMock.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    user: null,
  });
  useConvexAuthMock.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    isRefreshing: false,
  });
  useMutationMock.mockReturnValue(jest.fn());
  useQueriesMock.mockReturnValue({});
});

describe("NativeDataAuthProvider", () => {
  it("composes one stable client through Clerk, Convex, public data, and auth", () => {
    const props = {
      clerkPublishableKey: "pk_test_public-example",
      convexUrl: "https://standing-finch-735.convex.cloud",
    };
    const { rerender } = render(
      <NativeDataAuthProvider {...props}>
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );
    const client = convexClientConstructor.mock.results[0]?.value;

    expect(convexClientConstructor).toHaveBeenCalledTimes(1);
    expect(convexClientConstructor).toHaveBeenCalledWith(props.convexUrl);
    expect(mockClerkProviderBoundary.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        publishableKey: props.clerkPublishableKey,
        tokenCache,
      }),
    );
    expect(mockConvexProviderBoundary.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        client,
        useAuth,
      }),
    );
    expect(screen.getByTestId("clerk-provider")).toContainElement(
      screen.getByTestId("convex-provider"),
    );
    expect(screen.getByTestId("convex-provider")).toContainElement(
      screen.getByTestId("public-reader-consumer"),
    );

    rerender(
      <NativeDataAuthProvider {...props}>
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );

    expect(convexClientConstructor).toHaveBeenCalledTimes(1);
    expect(mockConvexProviderBoundary.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ client }),
    );
  });

  it("keeps public Wikipedia search available while private identity is skipped", async () => {
    render(
      <NativeDataAuthProvider
        clerkPublishableKey="pk_test_public-example"
        convexUrl="https://standing-finch-735.convex.cloud"
      >
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );

    expect(screen.getByText("signedOut")).toBeOnTheScreen();
    expect(screen.getByTestId("library-status")).toHaveTextContent(
      "library:signedOut",
    );
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});

    fireEvent.press(screen.getByTestId("public-reader-consumer"));

    await waitFor(() =>
      expect(publicSearch).toHaveBeenCalledWith({ term: "Ada" }),
    );
  });

  it("keeps public Wikipedia search available when the private viewer query fails", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "session-a",
      signOut: clerkSignOut,
      userId: "user-a",
    } as unknown as ReturnType<typeof useAuth>);
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "user-a" },
    } as ReturnType<typeof useUser>);
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      isRefreshing: false,
    });
    useQueriesMock.mockReturnValue({
      nativeViewer: new Error(
        "tokenIdentifier=private issuer=https://issuer.example",
      ),
    });

    render(
      <NativeDataAuthProvider
        clerkPublishableKey="pk_test_public-example"
        convexUrl="https://standing-finch-735.convex.cloud"
      >
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );

    expect(screen.getByText("bridgeError")).toBeOnTheScreen();
    expect(screen.queryByText(/tokenIdentifier|issuer\.example/)).toBeNull();

    fireEvent.press(screen.getByTestId("public-reader-consumer"));

    await waitFor(() =>
      expect(publicSearch).toHaveBeenCalledWith({ term: "Ada" }),
    );
  });
});
