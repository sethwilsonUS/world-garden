import { articleRouteFromTitle } from "@curio-garden/domain";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";

export interface WebArticleHandoffScreenProps {
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  slug: string;
  onBack: () => void;
  openArticle?: (url: string) => Promise<unknown>;
}

export function WebArticleHandoffScreen({
  focusHeading,
  slug,
  onBack,
  openArticle = Linking.openURL,
}: WebArticleHandoffScreenProps) {
  const [error, setError] = useState("");
  const route = articleRouteFromTitle(slug);
  const title = route.slug.replaceAll("_", " ");
  const webUrl = `https://curiogarden.org${route.canonicalPath}`;

  const handleOpenArticle = async () => {
    setError("");
    try {
      await openArticle(webUrl);
    } catch (error) {
      if (__DEV__) {
        console.warn("Could not open the web article handoff", error);
      }
      setError("Could not open the article. Please try again.");
    }
  };

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="web-article-handoff-screen"
    >
      <GardenButton
        hint="Returns to the Wikipedia search results."
        label="Back to search"
        onPress={onBack}
        variant="secondary"
      />

      <View style={styles.headingGroup}>
        <RouteHeading
          focusElement={focusHeading}
          focusKey={route.slug}
          testID="article-handoff-heading"
          title={title}
        />
        <GardenText color="foreground2">
          This article is available now on Curio Garden web. Native article
          reading is the next mobile slice.
        </GardenText>
      </View>

      <GardenCard>
        <GardenText color="accent" variant="eyebrow">
          Continue reading
        </GardenText>
        <GardenText color="foreground2">
          The article opens in your browser. Returning here keeps your search
          results in place.
        </GardenText>
        <GardenButton
          hint="Opens this article in your default browser."
          label="Open article on Curio Garden web"
          onPress={handleOpenArticle}
        />
        <AccessibleStatus
          accessibilityRole={error ? "alert" : undefined}
          color="critical"
          message={error}
          testID="article-handoff-error"
        />
      </GardenCard>
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
  },
  headingGroup: {
    gap: 12,
  },
});
