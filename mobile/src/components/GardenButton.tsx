import { useState, type ReactElement } from "react";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { Pressable, StyleSheet } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

export type GardenButtonVariant = "primary" | "secondary";

export interface GardenButtonProps {
  label: string;
  hint?: string;
  onPress: NonNullable<PressableProps["onPress"]>;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Mirrors React Native's Pressable test hook. */
  testOnly_pressed?: boolean;
  variant?: GardenButtonVariant;
}

export function GardenButton({
  label,
  hint,
  onPress,
  busy = false,
  disabled = false,
  style,
  testID,
  testOnly_pressed,
  variant = "primary",
}: GardenButtonProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || busy;
  const primary = variant === "primary";

  return (
    <Pressable
      accessible
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      accessibilityValue={busy ? { text: "In progress" } : undefined}
      disabled={unavailable}
      focusable={!unavailable}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        styles.button,
        {
          backgroundColor: primary ? colors.btnPrimary : colors.surface2,
          borderColor: primary ? colors.btnPrimary : colors.controlBorder,
          borderRadius: radii.xl,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
        pressed && !unavailable
          ? [
              styles.pressed,
              {
                backgroundColor: primary
                  ? colors.btnPrimaryHover
                  : colors.surface3,
              },
            ]
          : undefined,
        focused && !unavailable
          ? [
              styles.focused,
              {
                borderColor: primary ? colors.btnPrimaryText : colors.accent,
                outlineColor: colors.accent,
              },
            ]
          : undefined,
        unavailable ? styles.unavailable : undefined,
        styles.minimumTarget,
      ]}
      testID={testID}
      testOnly_pressed={testOnly_pressed}
    >
      {({ pressed }) => (
        <GardenText
          accessible={false}
          color={primary ? "btnPrimaryText" : "foreground"}
          style={[
            styles.label,
            { fontFamily: fonts.bodySemiBold },
            (pressed || focused) && !unavailable && styles.interactionLabel,
          ]}
        >
          {label}
          {busy ? " — in progress" : disabled ? " — unavailable" : ""}
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
  },
  minimumTarget: {
    minHeight: 48,
    minWidth: 48,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  interactionLabel: {
    textDecorationLine: "underline",
  },
  unavailable: {
    opacity: 0.55,
  },
  label: {
    textAlign: "center",
  },
});
