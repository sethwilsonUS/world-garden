import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import {
  articleRouteFromTitle,
  formatWikipediaSearchStatus,
  normalizeWikipediaSearchTerm,
  type WikipediaSearchResult,
} from "@curio-garden/domain";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { SearchResultLink } from "../components/SearchResultLink";
import { WikipediaSearchForm } from "../components/WikipediaSearchForm";
import { useWikipediaReader } from "../data/WikipediaReaderContext";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

const SAFE_SEARCH_ERROR = "Search failed. Check your connection and try again.";

type SearchState =
  | { kind: "idle"; requestKey: string; results: [] }
  | { kind: "loading"; requestKey: string; results: [] }
  | {
      kind: "ready";
      requestKey: string;
      results: WikipediaSearchResult[];
    }
  | { kind: "error"; requestKey: string; results: [] };

export interface SearchScreenProps {
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  isRouteActive?: boolean;
  term: string;
}

export function SearchScreen({
  focusHeading,
  isRouteActive = true,
  term,
}: SearchScreenProps) {
  const router = useRouter();
  const { colors } = useGardenTheme();
  const { search } = useWikipediaReader();
  const normalizedTerm = normalizeWikipediaSearchTerm(term);
  const requestGeneration = useRef(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestKey = `${normalizedTerm}\u0000${retryGeneration}`;
  const [status, setStatus] = useState({ message: "", requestKey });
  const [state, setState] = useState<SearchState>({
    kind: normalizedTerm ? "loading" : "idle",
    requestKey,
    results: [],
  });
  const currentState: SearchState =
    state.requestKey === requestKey
      ? state
      : {
          kind: normalizedTerm ? "loading" : "idle",
          requestKey,
          results: [],
        };
  const statusMessage = status.requestKey === requestKey ? status.message : "";
  const errorMessage = currentState.kind === "error" ? SAFE_SEARCH_ERROR : "";
  const screenTitle = normalizedTerm
    ? `Results for “${normalizedTerm}”`
    : "Search Wikipedia";

  useEffect(() => {
    const generation = ++requestGeneration.current;
    let cancelled = false;

    if (!normalizedTerm) {
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled && generation === requestGeneration.current) {
        setStatus({
          message: formatWikipediaSearchStatus(normalizedTerm),
          requestKey,
        });
      }
    });

    void Promise.resolve()
      .then(() => search({ term: normalizedTerm }))
      .then((results) => {
        if (cancelled || generation !== requestGeneration.current) return;
        setState({ kind: "ready", requestKey, results });
        setStatus({
          message: formatWikipediaSearchStatus(normalizedTerm, results.length),
          requestKey,
        });
      })
      .catch(() => {
        if (cancelled || generation !== requestGeneration.current) return;
        setState({ kind: "error", requestKey, results: [] });
        setStatus({ message: "", requestKey });
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedTerm, requestKey, search]);

  const submitRefinement = (nextTerm: string) => {
    if (nextTerm === normalizedTerm) {
      setRetryGeneration((current) => current + 1);
      return;
    }

    router.replace({ pathname: "/search", params: { q: nextTerm } });
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <GardenScreen contentContainerStyle={styles.screen} testID="search-screen">
      <GardenButton label="Back to home" onPress={goBack} variant="secondary" />
      <RouteHeading
        active={isRouteActive}
        focusElement={focusHeading}
        focusKey={normalizedTerm}
        testID="search-screen-heading"
        title={screenTitle}
      />

      {!normalizedTerm ? (
        <>
          <WikipediaSearchForm onSubmit={submitRefinement} />
          <GardenCard style={styles.centeredCard}>
            <GardenText variant="cardTitle">Plant a seed</GardenText>
            <GardenText color="muted">
              Enter a topic above to search Wikipedia.
            </GardenText>
          </GardenCard>
        </>
      ) : (
        <>
          <AccessibleStatus
            accessible={Boolean(statusMessage)}
            announcementMode={isRouteActive ? "automatic" : "none"}
            message={statusMessage}
            testID="search-status"
          />

          <View
            accessibilityElementsHidden={!errorMessage}
            accessible={false}
            importantForAccessibility={
              errorMessage ? "auto" : "no-hide-descendants"
            }
            style={!errorMessage ? styles.hidden : undefined}
            testID="search-error-region"
          >
            <GardenCard>
              <AccessibleStatus
                accessibilityRole={errorMessage ? "alert" : undefined}
                announcementMode={isRouteActive ? "automatic" : "none"}
                color="critical"
                message={errorMessage}
                testID="search-error-status"
              />
              <GardenButton
                hint="Repeats the Wikipedia search."
                label="Try again"
                onPress={() => setRetryGeneration((current) => current + 1)}
                variant="secondary"
              />
            </GardenCard>
          </View>

          {currentState.kind === "ready" &&
          currentState.results.length === 0 ? (
            <GardenCard style={styles.centeredCard}>
              <GardenText variant="cardTitle">No seeds found</GardenText>
              <GardenText color="muted">
                Try searching for a different topic.
              </GardenText>
            </GardenCard>
          ) : null}

          {currentState.kind === "ready" && currentState.results.length > 0 ? (
            <View accessible={false} style={styles.results}>
              {currentState.results.map((result, index) => (
                <SearchResultLink
                  key={result.wikiPageId}
                  onPress={() => {
                    const route = articleRouteFromTitle(result.title);
                    router.push({
                      pathname: "/article/[slug]",
                      params: { slug: route.slug },
                    });
                  }}
                  position={index + 1}
                  result={result}
                />
              ))}
            </View>
          ) : null}

          <View
            accessible={false}
            style={[styles.refine, { borderTopColor: colors.border }]}
          >
            <GardenText color="muted" variant="metadata">
              Refine your search
            </GardenText>
            <WikipediaSearchForm
              key={normalizedTerm}
              defaultValue={normalizedTerm}
              onSubmit={submitRefinement}
            />
          </View>
        </>
      )}
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: 24,
  },
  centeredCard: {
    alignItems: "center",
  },
  hidden: {
    display: "none",
  },
  results: {
    gap: 8,
  },
  refine: {
    borderTopWidth: 1,
    gap: 12,
    paddingTop: 24,
  },
});
