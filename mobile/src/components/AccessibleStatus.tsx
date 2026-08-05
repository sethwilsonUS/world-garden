import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { GardenText, type GardenTextProps } from "../theme/GardenText";

export interface AccessibleStatusProps extends Omit<
  GardenTextProps,
  "accessibilityLiveRegion" | "aria-live" | "children"
> {
  message: string;
}

function announcePolitely(message: string) {
  if (
    typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function"
  ) {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      queue: true,
      priority: "low",
    });
    return;
  }

  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * A visible status message that uses each platform's reliable polite-update
 * mechanism without announcing the same update twice.
 */
export function AccessibleStatus({
  message,
  ...textProps
}: AccessibleStatusProps) {
  const previousMessage = useRef(message.trim());

  useEffect(() => {
    const normalizedMessage = message.trim();
    const isTransition = normalizedMessage !== previousMessage.current;

    previousMessage.current = normalizedMessage;

    if (Platform.OS === "ios" && isTransition && normalizedMessage.length > 0) {
      announcePolitely(normalizedMessage);
    }
  }, [message]);

  return (
    <GardenText
      {...textProps}
      accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}
      color={textProps.color ?? "foreground2"}
    >
      {message}
    </GardenText>
  );
}
