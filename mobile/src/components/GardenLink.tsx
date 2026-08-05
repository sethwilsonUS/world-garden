import { useEffect, useRef, useState, type ReactElement } from "react";
import { Linking, Pressable, StyleSheet } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

export type GardenLinkAttempt = symbol;

export interface GardenLinkProps {
  label: string;
  url: string;
  hint?: string;
  openUrl?: (url: string) => Promise<unknown>;
  onOpenStart?: (attempt: GardenLinkAttempt) => void;
  onOpenError?: (attempt: GardenLinkAttempt) => void;
  testID?: string;
  /** Mirrors React Native's Pressable test hook. */
  testOnly_pressed?: boolean;
}

const unsafeUrlCharacters = /[\s\u0000-\u001f\u007f-\u009f]/u;
const explicitHttpsScheme = /^https:\/\//iu;

/**
 * Keeps OS handoffs on a deliberately narrow, inspectable boundary.
 * The original URL is returned so callers never receive a silently rewritten
 * destination.
 */
export function normalizeSafeExternalUrl(value: string): string | null {
  if (
    !value ||
    unsafeUrlCharacters.test(value) ||
    !explicitHttpsScheme.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }

    return value;
  } catch (error) {
    void error;
    return null;
  }
}

export function GardenLink({
  label,
  url,
  hint,
  openUrl = Linking.openURL,
  onOpenStart,
  onOpenError,
  testID,
  testOnly_pressed,
}: GardenLinkProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const mounted = useRef(true);
  const launchGeneration = useRef(0);
  const safeUrl = normalizeSafeExternalUrl(url);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      launchGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    launchGeneration.current += 1;
  }, [openUrl, safeUrl]);

  if (!safeUrl) {
    const unavailableLabel = `${label} — link unavailable`;

    return (
      <GardenText
        accessibilityLabel={unavailableLabel}
        color="muted"
        style={styles.unavailableLabel}
        testID={testID}
      >
        {unavailableLabel}
      </GardenText>
    );
  }

  const handlePress = async () => {
    const generation = ++launchGeneration.current;
    const attempt: GardenLinkAttempt = Symbol("garden-link-attempt");
    onOpenStart?.(attempt);

    try {
      await openUrl(safeUrl);
    } catch (error) {
      void error;
      if (mounted.current && generation === launchGeneration.current) {
        onOpenError?.(attempt);
      }
    }
  };

  return (
    <Pressable
      accessible
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="link"
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.link,
        {
          borderRadius: radii.md,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.sm,
        },
        pressed
          ? [styles.pressed, { backgroundColor: colors.accentBg }]
          : undefined,
        focused
          ? [
              styles.focused,
              { borderColor: colors.accent, outlineColor: colors.accent },
            ]
          : undefined,
      ]}
      testID={testID}
      testOnly_pressed={testOnly_pressed}
    >
      {({ pressed }) => (
        <GardenText
          accessible={false}
          color="accent"
          style={[
            styles.label,
            { fontFamily: fonts.bodySemiBold },
            (pressed || focused) && styles.interactionLabel,
          ]}
        >
          {label}
        </GardenText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "transparent",
    borderWidth: 2,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 48,
    minWidth: 48,
  },
  label: {
    flexShrink: 1,
    textDecorationLine: "underline",
  },
  interactionLabel: {
    textDecorationStyle: "dashed",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  unavailableLabel: {
    maxWidth: "100%",
  },
});
