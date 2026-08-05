import { useState, type ReactElement } from "react";
import type { PressableProps } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";
import type { WikipediaSearchResult } from "@curio-garden/domain";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

export interface SearchResultLinkProps {
  onPress: NonNullable<PressableProps["onPress"]>;
  position: number;
  result: WikipediaSearchResult;
  /** Mirrors React Native's Pressable test hook. */
  testOnly_pressed?: boolean;
}

export function SearchResultLink({
  onPress,
  position,
  result,
  testOnly_pressed,
}: SearchResultLinkProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const description = result.description.trim();
  const accessibleName = `${position}. ${result.title}${
    description ? `: ${description}` : ""
  }`;

  return (
    <Pressable
      accessible
      accessibilityHint="Opens this article in Curio Garden."
      accessibilityLabel={accessibleName}
      accessibilityRole="link"
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.link,
        {
          backgroundColor: pressed ? colors.surface3 : colors.surface2,
          borderColor: focused ? colors.accent : colors.controlBorder,
          borderRadius: radii.xxl,
          gap: spacing.md,
          padding: spacing.lg,
        },
        pressed ? styles.pressed : undefined,
        focused ? [styles.focused, { outlineColor: colors.accent }] : undefined,
      ]}
      testOnly_pressed={testOnly_pressed}
    >
      {({ pressed }) => (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          accessible={false}
          style={{ gap: spacing.sm }}
        >
          <View
            accessible={false}
            style={[
              styles.position,
              {
                backgroundColor: colors.accentBg,
                borderColor: colors.accentBorder,
                borderRadius: radii.lg,
              },
            ]}
          >
            <GardenText accessible={false} color="accent" variant="metadata">
              {position}
            </GardenText>
          </View>
          <GardenText
            accessible={false}
            style={[
              { fontFamily: fonts.bodySemiBold },
              (pressed || focused) && styles.interactionTitle,
            ]}
            testID={`search-result-${result.wikiPageId}-title`}
          >
            {result.title}
          </GardenText>
          {description ? (
            <GardenText accessible={false} color="muted" variant="metadata">
              {description}
            </GardenText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: "stretch",
    borderWidth: 2,
    minHeight: 48,
    minWidth: 48,
  },
  position: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: 6,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  interactionTitle: {
    textDecorationLine: "underline",
  },
});
