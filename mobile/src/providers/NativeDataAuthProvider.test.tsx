import { useAuth } from "@clerk/expo";
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
import {
  useNativeClerkAuth,
  useNativeClerkSession,
  useNativeClerkUser,
} from "../auth/NativeClerkBoundary";
import { convexClientApi } from "../data/convexClientApi";
import { useNativeListeningProgressQueryClient } from "../data/NativeListeningProgressQueryBoundary";
import { useWikipediaReader } from "../data/WikipediaReaderContext";
import { useNativeLibrary } from "../library/NativeLibraryContext";
import { useNativeListeningProgress } from "../listening/NativeListeningProgressContext";
import { useNativeArticleAudioAccess } from "../media/NativeArticleAudioAccessContext";
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
}));

jest.mock("../auth/NativeClerkBoundary", () => ({
  useNativeClerkAuth: jest.fn(),
  useNativeClerkSession: jest.fn(),
  useNativeClerkUser: jest.fn(),
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

jest.mock("../data/NativeListeningProgressQueryBoundary", () => ({
  useNativeListeningProgressQueryClient: jest.fn(),
}));

jest.mock("convex/react-clerk", () => ({
  ConvexProviderWithClerk: (props: PropsWithChildren) =>
    mockConvexProviderBoundary(props),
}));

const convexClientConstructor = jest.mocked(ConvexReactClient);
const useActionMock = useAction as jest.Mock;
const useNativeClerkAuthMock = jest.mocked(useNativeClerkAuth);
const useNativeClerkSessionMock = jest.mocked(useNativeClerkSession);
const useNativeClerkUserMock = jest.mocked(useNativeClerkUser);
const useConvexAuthMock = jest.mocked(useConvexAuth);
const useQueryClientMock = jest.mocked(
  useNativeListeningProgressQueryClient,
);
const useMutationMock = useMutation as jest.Mock;
const useQueriesMock = useQueries as jest.Mock;
const publicSearch = jest.fn();
const publicFetchArticle = jest.fn();
const progressQuery = jest.fn();
const clerkSignOut = jest.fn();

function PublicSignedOutConsumer() {
  const { state } = useNativeAuth();
  const library = useNativeLibrary();
  const listeningProgress = useNativeListeningProgress();
  const articleAudio = useNativeArticleAudioAccess();
  const reader = useWikipediaReader();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void reader.search({ term: "Ada" })}
      testID="public-reader-consumer"
    >
      <Text>{state.status}</Text>
      <Text testID="library-status">library:{library.state.status}</Text>
      <Text testID="media-access">
        media:{typeof articleAudio.requestSection}
      </Text>
      <Text testID="listening-progress-status">
        progress:{listeningProgress.availability}
      </Text>
    </Pressable>
  );
}

function ReadyProgressConsumer() {
  const progress = useNativeListeningProgress();

  return (
    <Pressable
      onPress={() =>
        void progress.openArticle({
          narrationVersion: 2,
          revisionId: "1234",
          wikiPageId: "736",
        })
      }
      testID="ready-progress-consumer"
    >
      <Text>progress:{progress.availability}</Text>
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
  useNativeClerkAuthMock.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut: clerkSignOut,
    userId: null,
  });
  useNativeClerkSessionMock.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    session: null,
  });
  useNativeClerkUserMock.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    user: null,
  });
  useConvexAuthMock.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    isRefreshing: false,
  });
  useQueryClientMock.mockReturnValue({ getNative: progressQuery });
  useMutationMock.mockReturnValue(jest.fn());
  useQueriesMock.mockReturnValue({});
});

describe("NativeDataAuthProvider", () => {
  it("composes one stable client through Clerk, Convex, public data, and auth", async () => {
    const props = {
      clerkPublishableKey: "pk_test_public-example",
      convexUrl: "https://standing-finch-735.convex.cloud",
      webOrigin: "https://curiogarden.org",
    };
    const { rerender } = await render(
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

    await rerender(
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
    await render(
      <NativeDataAuthProvider
        clerkPublishableKey="pk_test_public-example"
        convexUrl="https://standing-finch-735.convex.cloud"
        webOrigin="https://curiogarden.org"
      >
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );

    expect(screen.getByText("signedOut")).toBeOnTheScreen();
    expect(screen.getByTestId("library-status")).toHaveTextContent(
      "library:signedOut",
    );
    expect(screen.getByTestId("media-access")).toHaveTextContent(
      "media:function",
    );
    expect(screen.getByTestId("listening-progress-status")).toHaveTextContent(
      "progress:unavailable",
    );
    expect(useQueriesMock.mock.calls.at(-1)?.[0]).toEqual({});

    await fireEvent.press(screen.getByTestId("public-reader-consumer"));

    await waitFor(() =>
      expect(publicSearch).toHaveBeenCalledWith({ term: "Ada" }),
    );
  });

  it("keeps public Wikipedia search available when the private viewer query fails", async () => {
    useNativeClerkAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "session-a",
      signOut: clerkSignOut,
      userId: "user-a",
    });
    useNativeClerkUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "user-a" },
    });
    useNativeClerkSessionMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      session: {
        getToken: jest.fn(),
        id: "session-a",
        user: { id: "user-a" },
      },
    });
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

    await render(
      <NativeDataAuthProvider
        clerkPublishableKey="pk_test_public-example"
        convexUrl="https://standing-finch-735.convex.cloud"
        webOrigin="https://curiogarden.org"
      >
        <PublicSignedOutConsumer />
      </NativeDataAuthProvider>,
    );

    expect(screen.getByText("bridgeError")).toBeOnTheScreen();
    expect(screen.queryByText(/tokenIdentifier|issuer\.example/)).toBeNull();

    await fireEvent.press(screen.getByTestId("public-reader-consumer"));

    await waitFor(() =>
      expect(publicSearch).toHaveBeenCalledWith({ term: "Ada" }),
    );
  });

  it("composes the ready progress adapter with the audited account binding", async () => {
    useNativeClerkAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "session-a",
      signOut: clerkSignOut,
      userId: "user-a",
    });
    useNativeClerkUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "user-a" },
    });
    useNativeClerkSessionMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      session: {
        getToken: jest.fn(),
        id: "session-a",
        user: { id: "user-a" },
      },
    });
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      isRefreshing: false,
    });
    useQueriesMock.mockReturnValue({
      nativeViewer: {
        email: "ada@example.com",
        name: "Ada Lovelace",
        subject: "user-a",
      },
    });
    progressQuery.mockImplementation(
      async (args: { sessionEpochKey: string }) => ({
        cursor: null,
        cursorVersion: 0,
        sessionEpochKey: args.sessionEpochKey,
      }),
    );

    await render(
      <NativeDataAuthProvider
        clerkPublishableKey="pk_test_public-example"
        convexUrl="https://standing-finch-735.convex.cloud"
        webOrigin="https://curiogarden.org"
      >
        <ReadyProgressConsumer />
      </NativeDataAuthProvider>,
    );

    expect(screen.getByText("progress:ready")).toBeOnTheScreen();
    expect(progressQuery).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("ready-progress-consumer"));

    await waitFor(() => expect(progressQuery).toHaveBeenCalledTimes(1));
    expect(progressQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAccountSubject: "user-a",
        wikiPageId: "736",
      }),
    );
    expect(progressQuery.mock.calls[0]?.[0].sessionEpochKey).toMatch(
      /^native-epoch-/u,
    );
  });
});
