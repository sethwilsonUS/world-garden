import type { ReactElement } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

const BRAND_NAME = "Curio Garden";

export interface BrandHeadingProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The visual word units may wrap between words, but never split the brand name
 * within a word. The outer view supplies the single screen-reader heading.
 */
export function BrandHeading({
  style,
  testID = "brand-heading",
}: BrandHeadingProps): ReactElement {
  const { spacing } = useGardenTheme();

  return (
    <View
      accessible
      accessibilityLabel={BRAND_NAME}
      accessibilityRole="header"
      style={[styles.heading, style]}
      testID={testID}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        accessible={false}
        style={[styles.words, { columnGap: spacing.sm }]}
        testID={`${testID}-words`}
      >
        {/* The hero variant's cap keeps "Garden" intact on a narrow viewport
            after compact screen padding at the largest display size. */}
        <GardenText
          accessible={false}
          style={styles.word}
          testID={`${testID}-curio`}
          variant="hero"
        >
          Curio
        </GardenText>
        <GardenText
          accessible={false}
          style={styles.word}
          testID={`${testID}-garden`}
          variant="hero"
        >
          Garden
        </GardenText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignSelf: "stretch",
  },
  words: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  word: {
    flexShrink: 0,
  },
});
