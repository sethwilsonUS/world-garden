import { useEffect, useRef, type ReactElement } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import { GardenText } from "../theme/GardenText";

export interface RouteHeadingProps {
  /** Changes only when navigation establishes a new route context. */
  focusKey: string;
  /** Native focus adapter; injectable for deterministic renderer tests. */
  focusElement?: (element: View) => void;
  testID?: string;
  title: string;
}

function focusNativeElement(element: View) {
  const reactTag = findNodeHandle(element);
  if (reactTag !== null) {
    AccessibilityInfo.setAccessibilityFocus(reactTag);
  }
}

/**
 * Exposes one route title and moves screen-reader focus there after navigation
 * settles. Async content updates do not change `focusKey`, so they never steal
 * focus.
 */
export function RouteHeading({
  focusElement = focusNativeElement,
  focusKey,
  testID = "route-heading",
  title,
}: RouteHeadingProps): ReactElement {
  const headingRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    void AccessibilityInfo.isScreenReaderEnabled()
      .then((screenReaderEnabled) => {
        if (!screenReaderEnabled || cancelled) return;

        // Cold Android links can assign initial focus after React commits, so
        // allow its startup focus to settle before moving focus exactly once.
        // The cleanup prevents superseded terms from receiving late focus.
        focusTimer = setTimeout(
          () => {
            if (cancelled) return;

            if (headingRef.current) {
              focusElement(headingRef.current);
            }
          },
          Platform.OS === "android" ? 500 : 100,
        );
      })
      .catch(() => {
        // A failed preference query must not make the route unusable.
      });

    return () => {
      cancelled = true;
      if (focusTimer !== null) clearTimeout(focusTimer);
    };
  }, [focusElement, focusKey]);

  return (
    <View
      ref={headingRef}
      accessible
      accessibilityLabel={title}
      accessibilityRole="header"
      style={styles.heading}
      testID={testID}
    >
      <View
        accessibilityElementsHidden
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <GardenText accessible={false} variant="screenTitle">
          {title}
        </GardenText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignSelf: "stretch",
  },
});
