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
  accessible: accessibleOverride,
  message,
  ...textProps
}: AccessibleStatusProps) {
  const normalizedMessage = message.trim();
  const accessible = accessibleOverride ?? normalizedMessage.length > 0;
  const activeMessage = accessible ? normalizedMessage : "";
  const previousMessage = useRef(activeMessage);

  useEffect(() => {
    const isTransition = activeMessage !== previousMessage.current;

    previousMessage.current = activeMessage;

    if (Platform.OS === "ios" && isTransition && activeMessage.length > 0) {
      announcePolitely(activeMessage);
    }
  }, [activeMessage]);

  return (
    <GardenText
      {...textProps}
      accessible={accessible}
      accessibilityLiveRegion={
        Platform.OS === "android" && activeMessage ? "polite" : undefined
      }
      color={textProps.color ?? "foreground2"}
    >
      {message}
    </GardenText>
  );
}
