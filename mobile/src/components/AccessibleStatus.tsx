import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { GardenText, type GardenTextProps } from "../theme/GardenText";

export interface AccessibleStatusProps extends Omit<
  GardenTextProps,
  "accessibilityLiveRegion" | "aria-live" | "children"
> {
  announceOnReveal?: boolean;
  announcementMode?: "automatic" | "imperative" | "none";
  message: string;
}

function announcePolitely(message: string) {
  if (
    Platform.OS === "ios" &&
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
  announceOnReveal = true,
  announcementMode = "automatic",
  message,
  ...textProps
}: AccessibleStatusProps) {
  const normalizedMessage = message.trim();
  const accessible = accessibleOverride ?? normalizedMessage.length > 0;
  const activeMessage = accessible ? normalizedMessage : "";
  const previousMessage = useRef(activeMessage);
  const wasAccessible = useRef(accessible);

  useEffect(() => {
    const isTransition = activeMessage !== previousMessage.current;
    const becameAccessible = accessible && !wasAccessible.current;

    wasAccessible.current = accessible;
    if (accessible) previousMessage.current = activeMessage;

    if (
      isTransition &&
      activeMessage.length > 0 &&
      (!becameAccessible || announceOnReveal) &&
      (announcementMode === "imperative" ||
        (announcementMode === "automatic" && Platform.OS === "ios"))
    ) {
      announcePolitely(activeMessage);
    }
  }, [accessible, activeMessage, announceOnReveal, announcementMode]);

  return (
    <GardenText
      {...textProps}
      accessible={accessible}
      accessibilityLiveRegion={
        Platform.OS === "android" &&
        announcementMode === "automatic" &&
        activeMessage
          ? "polite"
          : undefined
      }
      color={textProps.color ?? "foreground2"}
    >
      {message}
    </GardenText>
  );
}
