import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ForwardedRef,
  type ReactElement,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type ViewProps,
} from "react-native";

import { GardenText } from "../theme/GardenText";

export interface RouteHeadingProps {
  /** Cancels deferred focus while a retained native-stack route is hidden. */
  active?: boolean;
  /** Changes only when navigation establishes a new route context. */
  focusKey: string;
  /** Native focus adapter; injectable for deterministic renderer tests. */
  focusElement?: (element: View) => void;
  onFocus?: ViewProps["onFocus"];
  testID?: string;
  title: string;
}

function focusNativeElement(element: View) {
  AccessibilityInfo.sendAccessibilityEvent(element, "focus");
}

function assignRef(ref: ForwardedRef<View>, element: View | null) {
  if (typeof ref === "function") {
    ref(element);
  } else if (ref) {
    ref.current = element;
  }
}

/**
 * Exposes one route title and moves screen-reader focus there after navigation
 * settles. Async content updates do not change `focusKey`, so they never steal
 * focus.
 */
export const RouteHeading = forwardRef<View, RouteHeadingProps>(
  function RouteHeading(
    {
      active = true,
      focusElement = focusNativeElement,
      focusKey,
      onFocus,
      testID = "route-heading",
      title,
    },
    forwardedRef,
  ): ReactElement {
    const headingRef = useRef<View>(null);
    const attemptedFocusKey = useRef<string | null>(null);
    const setHeadingRef = useCallback(
      (element: View | null) => {
        headingRef.current = element;
        assignRef(forwardedRef, element);
      },
      [forwardedRef],
    );

    useEffect(() => {
      if (!active || attemptedFocusKey.current === focusKey) return;
      attemptedFocusKey.current = focusKey;

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
    }, [active, focusElement, focusKey]);

    return (
      <View
        ref={setHeadingRef}
        accessible
        accessibilityLabel={title}
        accessibilityRole="header"
        onFocus={onFocus}
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
  },
);

const styles = StyleSheet.create({
  heading: {
    alignSelf: "stretch",
  },
});
