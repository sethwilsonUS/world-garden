import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export interface AccessibilityPreferences {
  /**
   * Starts enabled so nonessential motion stays off until the native setting
   * has been read. A failed native query therefore fails safely too.
   */
  reduceMotion: boolean;
  boldText: boolean;
  grayscale: boolean;
  invertColors: boolean;
  reduceTransparency: boolean;
  darkerSystemColors: boolean;
  highTextContrast: boolean;
  isReady: boolean;
}

type PreferenceKey = Exclude<keyof AccessibilityPreferences, "isReady">;

export type AccessibilityPreferenceChangeEventName =
  | "boldTextChanged"
  | "darkerSystemColorsChanged"
  | "grayscaleChanged"
  | "highTextContrastChanged"
  | "invertColorsChanged"
  | "reduceMotionChanged"
  | "reduceTransparencyChanged";

export interface AccessibilityPreferenceSubscription {
  readonly remove: () => void;
}

export type SubscribeToAccessibilityPreference = (
  eventName: AccessibilityPreferenceChangeEventName,
  handler: (enabled: boolean) => void,
) => AccessibilityPreferenceSubscription;

const subscribeToNativeAccessibilityPreference: SubscribeToAccessibilityPreference =
  (eventName, handler) =>
    AccessibilityInfo.addEventListener(eventName, handler);

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  reduceMotion: true,
  boldText: false,
  grayscale: false,
  invertColors: false,
  reduceTransparency: false,
  darkerSystemColors: false,
  highTextContrast: false,
  isReady: false,
};

export const DEFAULT_NONESSENTIAL_MOTION_DURATION_MS = 200;

/**
 * Nonessential transitions become immediate when Reduce Motion is enabled.
 */
export function getNonessentialMotionDuration(
  reduceMotion: boolean,
  durationMs = DEFAULT_NONESSENTIAL_MOTION_DURATION_MS,
): number {
  return reduceMotion ? 0 : Math.max(0, durationMs);
}

/**
 * Keeps the native accessibility display and motion preferences available to
 * components without requiring each component to manage native listeners.
 */
export function useAccessibilityPreferences(
  subscribe: SubscribeToAccessibilityPreference =
    subscribeToNativeAccessibilityPreference,
): AccessibilityPreferences {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(
    DEFAULT_ACCESSIBILITY_PREFERENCES,
  );

  useEffect(() => {
    let isMounted = true;
    const changedSinceQueryStarted = new Set<PreferenceKey>();
    const subscriptions: { remove: () => void }[] = [];

    const setPreference = (key: PreferenceKey, enabled: boolean) => {
      if (!isMounted) {
        return;
      }

      setPreferences((current) =>
        current[key] === enabled ? current : { ...current, [key]: enabled },
      );
    };

    const watchPreference = (
      key: PreferenceKey,
      eventName: AccessibilityPreferenceChangeEventName,
      query: () => Promise<boolean>,
    ): Promise<void> => {
      const handleChange = (enabled: boolean) => {
        changedSinceQueryStarted.add(key);
        setPreference(key, enabled);
      };

      subscriptions.push(
        subscribe(eventName, handleChange),
      );

      return Promise.resolve()
        .then(query)
        .then((enabled) => {
          // An event that arrived while the query was in flight is newer than
          // the query result and must win.
          if (!changedSinceQueryStarted.has(key)) {
            setPreference(key, enabled);
          }
        })
        .catch(() => {
          // Some older OS versions do not expose every preference. Retain the
          // conservative defaults instead of making accessibility startup fail.
        });
    };

    const pendingQueries = [
      watchPreference("reduceMotion", "reduceMotionChanged", () =>
        AccessibilityInfo.isReduceMotionEnabled(),
      ),
    ];

    if (Platform.OS === "ios") {
      pendingQueries.push(
        watchPreference("boldText", "boldTextChanged", () =>
          AccessibilityInfo.isBoldTextEnabled(),
        ),
        watchPreference("reduceTransparency", "reduceTransparencyChanged", () =>
          AccessibilityInfo.isReduceTransparencyEnabled(),
        ),
        watchPreference("darkerSystemColors", "darkerSystemColorsChanged", () =>
          AccessibilityInfo.isDarkerSystemColorsEnabled(),
        ),
        watchPreference("grayscale", "grayscaleChanged", () =>
          AccessibilityInfo.isGrayscaleEnabled(),
        ),
        watchPreference("invertColors", "invertColorsChanged", () =>
          AccessibilityInfo.isInvertColorsEnabled(),
        ),
      );
    }

    if (Platform.OS === "android") {
      pendingQueries.push(
        watchPreference("highTextContrast", "highTextContrastChanged", () =>
          AccessibilityInfo.isHighTextContrastEnabled(),
        ),
      );
    }

    void Promise.all(pendingQueries).then(() => {
      if (isMounted) {
        setPreferences((current) =>
          current.isReady ? current : { ...current, isReady: true },
        );
      }
    });

    return () => {
      isMounted = false;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [subscribe]);

  return preferences;
}
