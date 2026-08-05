import { StyleSheet } from "react-native";

import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";

export interface InvalidArticleLinkScreenProps {
  backLabel?: "Back to Library" | "Back to search";
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  isRouteActive?: boolean;
  onBack: () => void;
}

export function InvalidArticleLinkScreen({
  backLabel = "Back to search",
  focusHeading,
  isRouteActive = true,
  onBack,
}: InvalidArticleLinkScreenProps) {
  const returnsToLibrary = backLabel === "Back to Library";

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="invalid-article-link-screen"
    >
      <GardenButton
        hint={
          returnsToLibrary
            ? "Returns to your saved articles."
            : "Returns to Wikipedia search."
        }
        label={backLabel}
        onPress={onBack}
        variant="secondary"
      />

      <RouteHeading
        active={isRouteActive}
        focusElement={focusHeading}
        focusKey="invalid-article-link"
        testID="invalid-article-link-heading"
        title="Article link unavailable"
      />

      <GardenCard>
        <GardenText color="accent" variant="eyebrow">
          Invalid link
        </GardenText>
        <GardenText color="foreground2">
          {returnsToLibrary
            ? "This saved article link is missing a valid title. Return to your Library and choose another article."
            : "This article link is missing a valid title. Return to search and choose an article."}
        </GardenText>
      </GardenCard>
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
  },
});
