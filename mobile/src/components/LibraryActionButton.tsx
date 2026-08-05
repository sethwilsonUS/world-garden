import { useState, type ReactElement } from "react";
import type { PressableProps } from "react-native";
import { Pressable, StyleSheet } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

export interface LibraryActionButtonProps {
  readonly articleTitle: string;
  readonly busy?: boolean;
  readonly onPress: NonNullable<PressableProps["onPress"]>;
  readonly saved: boolean;
  readonly testID?: string;
  /** Mirrors React Native's Pressable test hook. */
  readonly testOnly_pressed?: boolean;
}

/**
 * One explicit save/remove control. Visible words and accessibility state both
 * communicate whether the article is already in the account Library.
 */
export function LibraryActionButton({
  articleTitle,
  busy = false,
  onPress,
  saved,
  testID = "article-library-action",
  testOnly_pressed,
}: LibraryActionButtonProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const actionLabel = saved ? "Saved to Library" : "Save to Library";
  const visibleLabel = busy ? `${actionLabel} — in progress` : actionLabel;
  const accessibilityLabel = busy
    ? saved
      ? `${visibleLabel}: remove ${articleTitle}`
      : `${visibleLabel}: ${articleTitle}`
    : saved
      ? `Saved to Library: remove ${articleTitle}`
      : `Save to Library: ${articleTitle}`;

  return (
    <Pressable
      accessible
      accessibilityHint={
        saved
          ? "Removes this article from your Curio Garden account."
          : "Saves this article to your Curio Garden account."
      }
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy, selected: saved }}
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={(event) => {
        if (!busy) onPress(event);
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: saved ? colors.accentBg : colors.btnPrimary,
          borderColor: saved ? colors.accent : colors.btnPrimary,
          borderRadius: radii.xl,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
        pressed && !busy ? styles.pressed : undefined,
        focused ? [styles.focused, { outlineColor: colors.accent }] : undefined,
      ]}
      testID={testID}
      testOnly_pressed={testOnly_pressed}
    >
      {({ pressed }) => (
        <GardenText
          accessible={false}
          color={saved ? "accent" : "btnPrimaryText"}
          style={[
            styles.label,
            { fontFamily: fonts.bodySemiBold },
            (pressed || focused) && !busy ? styles.interactionLabel : undefined,
          ]}
        >
          {visibleLabel}
        </GardenText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "stretch",
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  interactionLabel: {
    textDecorationLine: "underline",
  },
  label: {
    textAlign: "center",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
