import type { WikipediaArticle } from "@curio-garden/domain";
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { ArticleDocument } from "../components/ArticleDocument";
import type { GardenLinkAttempt } from "../components/GardenLink";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { useWikipediaReader } from "../data/WikipediaReaderContext";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";

const SAFE_ARTICLE_ERROR =
  "Could not load this article. Check your connection and try again.";
const SAFE_LINK_ERROR = "Could not open this link. Please try again.";

type ArticleState =
  | { kind: "loading"; requestKey: string }
  | { kind: "ready"; requestKey: string; article: WikipediaArticle }
  | { kind: "error"; requestKey: string };

type ArticleStatus = {
  kind: "idle" | "loading" | "ready" | "error";
  message: string;
  requestKey: string;
};

export interface ArticleScreenProps {
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  onBack: () => void;
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
  focusHeading,
  onBack,
  openUrl,
  slug,
}: ArticleScreenProps) {
  const { fetchArticle } = useWikipediaReader();
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
  const currentState: ArticleState =
    state.requestKey === requestKey ? state : { kind: "loading", requestKey };
  const currentStatus: ArticleStatus =
    status.requestKey === requestKey
      ? status
      : { kind: "idle", message: "", requestKey };

  useEffect(() => {
    const generation = ++requestGeneration.current;
    let cancelled = false;
    latestExternalLinkAttempt.current = null;

    queueMicrotask(() => {
      if (!cancelled && generation === requestGeneration.current) {
        setStatus({
          kind: "loading",
          message: `Loading ${provisionalTitle}.`,
          requestKey,
        });
      }
    });

    void Promise.resolve()
      .then(() => fetchArticle({ slug }))
      .then((article) => {
        if (cancelled || generation !== requestGeneration.current) return;
        setState({ article, kind: "ready", requestKey });
        setStatus({
          kind: "ready",
          message: loadedStatus(article),
          requestKey,
        });
      })
      .catch(() => {
        if (cancelled || generation !== requestGeneration.current) return;
        setState({ kind: "error", requestKey });
        setStatus({
          kind: "error",
          message: SAFE_ARTICLE_ERROR,
          requestKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fetchArticle, provisionalTitle, requestKey, slug]);

  const headingTitle =
    currentState.kind === "ready"
      ? currentState.article.title
      : provisionalTitle;
  const statusIsError = currentStatus.kind === "error";

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="article-screen"
    >
      <GardenButton
        hint="Returns to the Wikipedia search results."
        label="Back to search"
        onPress={onBack}
        variant="secondary"
      />

      <RouteHeading
        focusElement={focusHeading}
        focusKey={slug}
        testID="article-screen-heading"
        title={headingTitle}
      />

      <AccessibleStatus
        accessibilityRole={statusIsError ? "alert" : undefined}
        color={statusIsError ? "critical" : "foreground2"}
        message={currentStatus.message}
        testID="article-status"
      />

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
