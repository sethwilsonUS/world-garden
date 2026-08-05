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
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  onBack: () => void;
}

export function InvalidArticleLinkScreen({
  focusHeading,
  onBack,
}: InvalidArticleLinkScreenProps) {
  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="invalid-article-link-screen"
    >
      <GardenButton
        hint="Returns to Wikipedia search."
        label="Back to search"
        onPress={onBack}
        variant="secondary"
      />

      <RouteHeading
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
          This article link is missing a title. Return to search and choose an
          article.
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
