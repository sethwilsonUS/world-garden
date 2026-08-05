import { isBookmarkSaved, type WikipediaArticle } from "@curio-garden/domain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { ArticleDocument } from "../components/ArticleDocument";
import type { GardenLinkAttempt } from "../components/GardenLink";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import { LibraryActionButton } from "../components/LibraryActionButton";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { useWikipediaReader } from "../data/WikipediaReaderContext";
import { GardenScreen } from "../layout/GardenScreen";
import {
  useNativeLibrary,
  type NativeLibraryState,
} from "../library/NativeLibraryContext";
import {
  bookmarkEntriesRevision,
  SAFE_LIBRARY_UPDATE_ERROR,
} from "../library/bookmarkPresentation";
import { GardenText } from "../theme/GardenText";

const SAFE_ARTICLE_ERROR =
  "Could not load this article. Check your connection and try again.";
const SAFE_LINK_ERROR = "Could not open this link. Please try again.";
const ARTICLE_REQUEST_TIMEOUT_MS = 15_000;
const LIBRARY_ECHO_TIMEOUT_MS = 2_000;

type ArticleState =
  | { kind: "loading"; requestKey: string }
  | { kind: "ready"; requestKey: string; article: WikipediaArticle }
  | { kind: "error"; requestKey: string };

type ArticleStatus = {
  kind: "idle" | "loading" | "ready" | "error";
  message: string;
  requestKey: string;
};

type LibraryActionStatus =
  | { kind: "idle"; message: ""; requestKey: string }
  | {
      kind: "busy";
      message: string;
      requestKey: string;
    }
  | {
      awaitingExpectedEcho: boolean;
      entriesRevision: string;
      expectedSaved: boolean | null;
      kind: "success" | "notice" | "error";
      message: string;
      requestKey: string;
    };

type ScopedLibraryActionStatus = Readonly<{
  accountEpoch: symbol;
  libraryStatus: NativeLibraryState["status"];
  scope: symbol;
  status: LibraryActionStatus;
}>;

type LibraryStatusObservation = Readonly<{
  accountEpoch: symbol;
  articleReady: boolean;
  articleSaved: boolean | null;
  libraryStatus: NativeLibraryState["status"];
}>;

export interface ArticleScreenProps {
  backLabel?: "Back to Library" | "Back to search";
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  isRouteActive?: boolean;
  onBack: () => void;
  onOpenAccount: () => void;
  openUrl?: (url: string) => Promise<unknown>;
  slug: string;
}

function provisionalTitleFromSlug(slug: string): string {
  return slug.normalize("NFC").replaceAll("_", " ");
}

function readableSectionCount(article: WikipediaArticle): number {
  return (article.sections ?? []).filter((section) => section.content.trim())
    .length;
}

function loadedStatus(article: WikipediaArticle): string {
  const count = readableSectionCount(article);
  if (count === 0) return "Article loaded. No readable sections available.";
  return `Article loaded. ${count} section${count === 1 ? "" : "s"} available.`;
}

export function ArticleScreen({
  backLabel = "Back to search",
  focusHeading,
  isRouteActive = true,
  onBack,
  onOpenAccount,
  openUrl,
  slug,
}: ArticleScreenProps) {
  const { fetchArticle } = useWikipediaReader();
  const library = useNativeLibrary();
  const currentLibraryState = useRef(library.state);
  const requestGeneration = useRef(0);
  const latestExternalLinkAttempt = useRef<GardenLinkAttempt | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestKey = `${slug}\u0000${retryGeneration}`;
  const provisionalTitle = provisionalTitleFromSlug(slug);
  const [state, setState] = useState<ArticleState>({
    kind: "loading",
    requestKey,
  });
  const [status, setStatus] = useState<ArticleStatus>({
    kind: "idle",
    message: "",
    requestKey,
  });
  const [scopedLibraryActionStatus, setScopedLibraryActionStatus] =
    useState<ScopedLibraryActionStatus>(() => ({
      accountEpoch: library.accountEpoch,
      libraryStatus: library.state.status,
      scope: Symbol("article-library-action-scope"),
      status: { kind: "idle", message: "", requestKey },
    }));
  if (
    scopedLibraryActionStatus.accountEpoch !== library.accountEpoch ||
    scopedLibraryActionStatus.libraryStatus !== library.state.status ||
    scopedLibraryActionStatus.status.requestKey !== requestKey
  ) {
    setScopedLibraryActionStatus({
      accountEpoch: library.accountEpoch,
      libraryStatus: library.state.status,
      scope: Symbol("article-library-action-scope"),
      status: { kind: "idle", message: "", requestKey },
    });
  }
  const libraryActionScope = scopedLibraryActionStatus.scope;
  const currentState: ArticleState =
    state.requestKey === requestKey ? state : { kind: "loading", requestKey };
  const currentStatus: ArticleStatus =
    status.requestKey === requestKey
      ? status
      : { kind: "idle", message: "", requestKey };
  const [libraryStatusObservation, setLibraryStatusObservation] =
    useState<LibraryStatusObservation>(() => ({
      accountEpoch: library.accountEpoch,
      articleReady: currentState.kind === "ready",
      articleSaved:
        currentState.kind === "ready" && library.state.status === "ready"
          ? isBookmarkSaved(library.state.entries, slug)
          : null,
      libraryStatus: library.state.status,
    }));
  const libraryAccountChanged =
    libraryStatusObservation.accountEpoch !== library.accountEpoch;
  const observedArticleSaved =
    currentState.kind === "ready" && library.state.status === "ready"
      ? isBookmarkSaved(library.state.entries, slug)
      : null;
  if (
    libraryAccountChanged ||
    libraryStatusObservation.articleReady !== (currentState.kind === "ready") ||
    libraryStatusObservation.articleSaved !== observedArticleSaved ||
    libraryStatusObservation.libraryStatus !== library.state.status
  ) {
    setLibraryStatusObservation({
      accountEpoch: library.accountEpoch,
      articleReady: currentState.kind === "ready",
      articleSaved: observedArticleSaved,
      libraryStatus: library.state.status,
    });
    if (currentState.kind === "ready") {
      switch (library.state.status) {
        case "error":
          setStatus({
            kind: "error",
            message: library.state.message,
            requestKey,
          });
          break;
        case "signedOut":
          setStatus({
            kind: "ready",
            message: "Signed out. Sign in to save articles to your Library.",
            requestKey,
          });
          break;
        case "connecting":
        case "loading":
          setStatus({
            kind: "loading",
            message: "Connecting your Library.",
            requestKey,
          });
          break;
        case "ready":
          if (libraryAccountChanged) {
            setStatus({
              kind: "ready",
              message: "Library connected to the current account.",
              requestKey,
            });
          } else if (libraryStatusObservation.libraryStatus !== "ready") {
            setStatus({
              kind: "ready",
              message: "Library connected.",
              requestKey,
            });
          } else if (
            libraryStatusObservation.articleReady &&
            libraryStatusObservation.articleSaved !== null &&
            libraryStatusObservation.articleSaved !== observedArticleSaved
          ) {
            setStatus({
              kind: "ready",
              message: observedArticleSaved
                ? `Library updated. ${currentState.article.title} is saved to your Library.`
                : `Library updated. ${currentState.article.title} is not saved to your Library.`,
              requestKey,
            });
          }
          break;
      }
    }
  }
  const currentLibraryActionStatus: LibraryActionStatus =
    scopedLibraryActionStatus.accountEpoch === library.accountEpoch &&
    scopedLibraryActionStatus.status.requestKey === requestKey
      ? scopedLibraryActionStatus.status
      : { kind: "idle", message: "", requestKey };
  if (
    currentState.kind === "ready" &&
    library.state.status === "ready" &&
    (currentLibraryActionStatus.kind === "success" ||
      currentLibraryActionStatus.kind === "notice" ||
      currentLibraryActionStatus.kind === "error")
  ) {
    const revision = bookmarkEntriesRevision(library.state.entries);
    if (currentLibraryActionStatus.entriesRevision !== revision) {
      const saved = isBookmarkSaved(library.state.entries, slug);
      const stillAwaitingExpectedEcho =
        currentLibraryActionStatus.kind === "success" &&
        currentLibraryActionStatus.awaitingExpectedEcho;
      if (
        stillAwaitingExpectedEcho &&
        currentLibraryActionStatus.expectedSaved === saved
      ) {
        setScopedLibraryActionStatus((current) =>
          current.scope === scopedLibraryActionStatus.scope &&
          current.status.kind === "success"
            ? {
                ...current,
                status: {
                  ...current.status,
                  awaitingExpectedEcho: false,
                  entriesRevision: revision,
                },
              }
            : current,
        );
      } else {
        setScopedLibraryActionStatus({
          accountEpoch: library.accountEpoch,
          libraryStatus: library.state.status,
          scope: Symbol("article-library-action-scope"),
          status: { kind: "idle", message: "", requestKey },
        });
        setStatus({
          kind: "ready",
          message: saved
            ? `Library updated. ${currentState.article.title} is saved to your Library.`
            : `Library updated. ${currentState.article.title} is not saved to your Library.`,
          requestKey,
        });
      }
    }
  }
  const setLibraryActionStatus = (
    status: LibraryActionStatus,
    expectedScope = libraryActionScope,
  ) => {
    setScopedLibraryActionStatus((current) =>
      current.scope === expectedScope ? { ...current, status } : current,
    );
  };
  const activeLibraryActionStatus: LibraryActionStatus =
    library.state.status === "ready"
      ? currentLibraryActionStatus
      : { kind: "idle", message: "", requestKey };
  const awaitingLibraryEchoScope =
    currentState.kind === "ready" &&
    currentLibraryActionStatus.kind === "success" &&
    currentLibraryActionStatus.awaitingExpectedEcho
      ? scopedLibraryActionStatus.scope
      : null;
  const awaitingLibraryEchoTitle =
    awaitingLibraryEchoScope === null || currentState.kind !== "ready"
      ? null
      : currentState.article.title;

  useLayoutEffect(() => {
    currentLibraryState.current = library.state;
  }, [library.state]);

  useEffect(() => {
    if (awaitingLibraryEchoScope === null || awaitingLibraryEchoTitle === null)
      return;

    const timer = setTimeout(() => {
      const latestState = currentLibraryState.current;
      if (latestState.status !== "ready") return;
      const saved = isBookmarkSaved(latestState.entries, slug);
      setScopedLibraryActionStatus((current) =>
        current.scope === awaitingLibraryEchoScope &&
        current.status.kind === "success" &&
        current.status.awaitingExpectedEcho
          ? {
              ...current,
              scope: Symbol("article-library-action-scope"),
              status: { kind: "idle", message: "", requestKey },
            }
          : current,
      );
      setStatus({
        kind: "ready",
        message: saved
          ? `Library updated. ${awaitingLibraryEchoTitle} is saved to your Library.`
          : `Library updated. ${awaitingLibraryEchoTitle} is not saved to your Library.`,
        requestKey,
      });
    }, LIBRARY_ECHO_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [awaitingLibraryEchoScope, awaitingLibraryEchoTitle, requestKey, slug]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    let active = true;
    latestExternalLinkAttempt.current = null;

    queueMicrotask(() => {
      if (active && generation === requestGeneration.current) {
        setStatus({
          kind: "loading",
          message: `Loading ${provisionalTitle}.`,
          requestKey,
        });
      }
    });

    const failRequest = () => {
      if (!active || generation !== requestGeneration.current) return;
      active = false;
      clearTimeout(timeoutId);
      setState({ kind: "error", requestKey });
      setStatus({
        kind: "error",
        message: SAFE_ARTICLE_ERROR,
        requestKey,
      });
    };
    const timeoutId = setTimeout(failRequest, ARTICLE_REQUEST_TIMEOUT_MS);

    void Promise.resolve()
      .then(() => fetchArticle({ slug }))
      .then((article) => {
        if (!active || generation !== requestGeneration.current) return;
        active = false;
        clearTimeout(timeoutId);
        setState({ article, kind: "ready", requestKey });
        setStatus({
          kind: "ready",
          message: loadedStatus(article),
          requestKey,
        });
      })
      .catch(failRequest);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [fetchArticle, provisionalTitle, requestKey, slug]);

  const headingTitle =
    currentState.kind === "ready"
      ? currentState.article.title
      : provisionalTitle;
  const displayedStatus =
    activeLibraryActionStatus.kind !== "idle"
      ? activeLibraryActionStatus.message
      : currentStatus.message;
  const statusIsError =
    activeLibraryActionStatus.kind === "error" ||
    (activeLibraryActionStatus.kind === "idle" &&
      currentStatus.kind === "error");
  const pendingExpectedSavedState =
    activeLibraryActionStatus.kind === "success" &&
    activeLibraryActionStatus.awaitingExpectedEcho
      ? activeLibraryActionStatus.expectedSaved
      : null;
  const articleSaved =
    currentState.kind === "ready" &&
    library.state.status === "ready" &&
    (pendingExpectedSavedState ?? isBookmarkSaved(library.state.entries, slug));
  const libraryActionBusy =
    currentState.kind === "ready" &&
    library.state.status === "ready" &&
    (library.isMutating(slug) ||
      activeLibraryActionStatus.kind === "busy" ||
      (activeLibraryActionStatus.kind === "success" &&
        activeLibraryActionStatus.awaitingExpectedEcho));

  const clearLibraryActionStatus = () => {
    setScopedLibraryActionStatus((current) => ({
      ...current,
      scope: Symbol("article-library-action-scope"),
      status: { kind: "idle", message: "", requestKey },
    }));
  };

  const performLibraryAction = async () => {
    if (currentState.kind !== "ready" || library.state.status !== "ready") {
      return;
    }

    const actionScope = libraryActionScope;
    const title = currentState.article.title;
    const removing = isBookmarkSaved(library.state.entries, slug);
    setStatus({ kind: "idle", message: "", requestKey });
    setLibraryActionStatus(
      {
        kind: "busy",
        message: removing
          ? `Removing ${title} from your Library.`
          : `Saving ${title} to your Library.`,
        requestKey,
      },
      actionScope,
    );

    let result;
    try {
      result = removing
        ? await library.removeBookmark({ slug })
        : await library.saveBookmark({ slug, title });
    } catch (error) {
      void error;
      result = {
        message: SAFE_LIBRARY_UPDATE_ERROR,
        status: "failed",
      } as const;
    }
    if (result.status === "superseded") {
      const latestState = currentLibraryState.current;
      const completedMetadata =
        latestState.status === "ready"
          ? {
              awaitingExpectedEcho: false,
              entriesRevision: bookmarkEntriesRevision(latestState.entries),
              expectedSaved: null,
            }
          : {
              awaitingExpectedEcho: false,
              entriesRevision: "",
              expectedSaved: null,
            };
      setLibraryActionStatus(
        {
          ...completedMetadata,
          kind: "notice",
          message:
            "Library action stopped. Check the current saved state before trying again.",
          requestKey,
        },
        actionScope,
      );
      return;
    }
    if (result.status === "failed") {
      const latestState = currentLibraryState.current;
      const completedMetadata =
        latestState.status === "ready"
          ? {
              awaitingExpectedEcho: false,
              entriesRevision: bookmarkEntriesRevision(latestState.entries),
              expectedSaved: null,
            }
          : {
              awaitingExpectedEcho: false,
              entriesRevision: "",
              expectedSaved: null,
            };
      setLibraryActionStatus(
        {
          ...completedMetadata,
          kind: "error",
          message: result.message,
          requestKey,
        },
        actionScope,
      );
      return;
    }

    const latestState = currentLibraryState.current;
    const expectedSaved = !removing;
    const completedMetadata =
      latestState.status === "ready"
        ? {
            awaitingExpectedEcho:
              isBookmarkSaved(latestState.entries, slug) !== expectedSaved,
            entriesRevision: bookmarkEntriesRevision(latestState.entries),
            expectedSaved,
          }
        : {
            awaitingExpectedEcho: false,
            entriesRevision: "",
            expectedSaved,
          };
    setLibraryActionStatus(
      {
        ...completedMetadata,
        kind: "success",
        message: removing
          ? `${title} removed from your Library.`
          : `${title} saved to your Library.`,
        requestKey,
      },
      actionScope,
    );
  };

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="article-screen"
    >
      <GardenButton
        hint={
          backLabel === "Back to Library"
            ? "Returns to your saved articles."
            : "Returns to the Wikipedia search results."
        }
        label={backLabel}
        onPress={onBack}
        variant="secondary"
      />

      <RouteHeading
        active={isRouteActive}
        focusElement={focusHeading}
        focusKey={slug}
        testID="article-screen-heading"
        title={headingTitle}
      />

      <AccessibleStatus
        accessibilityRole={statusIsError ? "alert" : undefined}
        announcementMode={isRouteActive ? "automatic" : "none"}
        color={statusIsError ? "critical" : "foreground2"}
        message={displayedStatus}
        testID="article-status"
      />

      {currentState.kind === "ready" && library.state.status === "ready" ? (
        <LibraryActionButton
          articleTitle={currentState.article.title}
          busy={libraryActionBusy}
          onPress={() => void performLibraryAction()}
          saved={articleSaved}
        />
      ) : null}

      {currentState.kind === "ready" && library.state.status === "signedOut" ? (
        <GardenCard>
          <GardenText variant="cardTitle">Save this article</GardenText>
          <GardenText color="foreground2">
            Sign in to save articles to your Library.
          </GardenText>
          <GardenButton
            hint="Opens sign-in and account settings."
            label="Go to Account"
            onPress={onOpenAccount}
            variant="secondary"
          />
        </GardenCard>
      ) : null}

      {currentState.kind === "ready" &&
      (library.state.status === "connecting" ||
        library.state.status === "loading") ? (
        <GardenCard>
          <GardenText variant="cardTitle">Connecting your Library</GardenText>
          <GardenText color="foreground2">
            Public reading remains available while your account catches up.
          </GardenText>
        </GardenCard>
      ) : null}

      {currentState.kind === "ready" && library.state.status === "error" ? (
        <GardenCard>
          <GardenText variant="cardTitle">Library unavailable</GardenText>
          <GardenText color="foreground2">
            Retry your saved articles without interrupting public reading.
          </GardenText>
          <GardenButton
            hint="Reconnects your account Library."
            label="Try Library again"
            onPress={() => {
              clearLibraryActionStatus();
              setStatus({ kind: "idle", message: "", requestKey });
              library.retry();
            }}
            variant="secondary"
          />
        </GardenCard>
      ) : null}

      {currentState.kind === "error" ? (
        <GardenCard testID="article-error-card">
          <GardenText variant="cardTitle">The trail went cold</GardenText>
          <GardenText color="foreground2">
            Retry the article request without leaving this screen.
          </GardenText>
          <GardenButton
            hint="Requests this Wikipedia article again."
            label="Try again"
            onPress={() => setRetryGeneration((current) => current + 1)}
            variant="secondary"
          />
        </GardenCard>
      ) : null}

      {currentState.kind === "ready" ? (
        <ArticleDocument
          article={currentState.article}
          onExternalLinkError={(attempt) => {
            if (latestExternalLinkAttempt.current !== attempt) return;
            setStatus({
              kind: "error",
              message: SAFE_LINK_ERROR,
              requestKey,
            });
          }}
          onExternalLinkStart={(attempt) => {
            latestExternalLinkAttempt.current = attempt;
            clearLibraryActionStatus();
            setStatus({ kind: "idle", message: "", requestKey });
          }}
          openUrl={openUrl}
        />
      ) : null}
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
  },
});
