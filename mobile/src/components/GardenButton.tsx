import { useState, type ReactElement } from "react";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { Pressable, StyleSheet } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

export type GardenButtonVariant = "primary" | "secondary";

export interface GardenButtonProps {
  accessibilityLabel?: string;
  label: string;
  hint?: string;
  onFocus?: PressableProps["onFocus"];
  onPress: NonNullable<PressableProps["onPress"]>;
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  /** Keeps a currently focused sequential control in the accessibility order. */
  retainFocusWhenUnavailable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Mirrors React Native's Pressable test hook. */
  testOnly_pressed?: boolean;
  variant?: GardenButtonVariant;
}

export function GardenButton({
  accessibilityLabel,
  label,
  hint,
  onFocus,
  onPress,
  busy = false,
  disabled = false,
  expanded,
  retainFocusWhenUnavailable = false,
  style,
  testID,
  testOnly_pressed,
  variant = "primary",
}: GardenButtonProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || busy;
  const primary = variant === "primary";
  const stateSuffix = busy
    ? " — in progress"
    : disabled
      ? " — unavailable"
      : "";
  const visibleLabel = `${label}${stateSuffix}`;
  const accessibleLabel = `${accessibilityLabel ?? label}${stateSuffix}`;

  return (
    <Pressable
      accessible
      accessibilityHint={hint}
      accessibilityLabel={accessibleLabel}
      accessibilityRole="button"
      accessibilityState={{
        busy,
        disabled: unavailable,
        ...(expanded === undefined ? {} : { expanded }),
      }}
      disabled={retainFocusWhenUnavailable ? undefined : unavailable}
      focusable={!unavailable || retainFocusWhenUnavailable}
      onBlur={() => setFocused(false)}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onPress={(event) => {
        if (!unavailable) onPress(event);
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.btnPrimary : colors.surface2,
          borderColor: primary ? colors.btnPrimary : colors.controlBorder,
          borderRadius: radii.xl,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
        style,
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
        focused && (!unavailable || retainFocusWhenUnavailable)
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
            (pressed || focused) &&
              (!unavailable || retainFocusWhenUnavailable) &&
              styles.interactionLabel,
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
