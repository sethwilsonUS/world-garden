import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import {
  DEFAULT_NATIVE_PLAYBACK_RATE,
  formatNativePlaybackRate,
  getNextNativePlaybackRate,
  type NativePlaybackRate,
} from "./NativePlaybackRate";

export interface NativePlaybackSpeedControlProps {
  readonly disabled?: boolean;
  readonly onChange: (next: NativePlaybackRate) => boolean;
  readonly rate: NativePlaybackRate;
  readonly testID?: string;
}

function announcePlaybackRate(rate: NativePlaybackRate): void {
  const message = `Playback speed ${formatNativePlaybackRate(rate)}.`;
  if (
    Platform.OS === "ios" &&
    typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function"
  ) {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      priority: "low",
      queue: true,
    });
    return;
  }

  AccessibilityInfo.announceForAccessibility(message);
}

export function NativePlaybackSpeedControl({
  disabled = false,
  onChange,
  rate,
  testID,
}: NativePlaybackSpeedControlProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const rateRef = useRef(rate);
  const pendingAnnouncement = useRef<NativePlaybackRate | null>(null);
  const visibleRate = formatNativePlaybackRate(rate);
  const nextRate = getNextNativePlaybackRate(rate);

  useLayoutEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    const pendingRate = pendingAnnouncement.current;
    if (pendingRate === null) return;

    pendingAnnouncement.current = null;
    if (pendingRate === rate) announcePlaybackRate(rate);
  }, [rate]);

  return (
    <Pressable
      accessible
      accessibilityHint={
        disabled
          ? undefined
          : `Changes to ${formatNativePlaybackRate(nextRate)}.`
      }
      accessibilityLabel={`Playback speed ${visibleRate}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => {
        if (disabled) return;
        const requestedRate = getNextNativePlaybackRate(rateRef.current);
        if (!onChange(requestedRate)) return;

        rateRef.current = requestedRate;
        pendingAnnouncement.current = requestedRate;
      }}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: "transparent",
          borderColor: colors.controlBorder,
          borderRadius: radii.lg,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        pressed && !disabled
          ? [
              styles.pressed,
              {
                backgroundColor: colors.accentBg,
              },
            ]
          : undefined,
        focused
          ? [
              styles.focused,
              {
                borderColor: colors.accent,
                outlineColor: colors.accent,
              },
            ]
          : undefined,
      ]}
      testID={testID}
    >
      {({ pressed }) => (
        <GardenText
          accessible={false}
          color={rate === DEFAULT_NATIVE_PLAYBACK_RATE ? "muted" : "accent"}
          style={[
            { fontFamily: fonts.monoSemiBold },
            disabled ? styles.disabledLabel : undefined,
            (pressed || focused) && styles.interactionLabel,
          ]}
          variant="metadata"
        >
          {visibleRate}
        </GardenText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  disabledLabel: {
    opacity: 0.55,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  interactionLabel: {
    textDecorationLine: "underline",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
