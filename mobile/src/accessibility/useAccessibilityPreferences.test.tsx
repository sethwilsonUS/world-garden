import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import {
  DEFAULT_NONESSENTIAL_MOTION_DURATION_MS,
  getNonessentialMotionDuration,
  useAccessibilityPreferences,
  type SubscribeToAccessibilityPreference,
} from "./useAccessibilityPreferences";

type ChangeHandler = (enabled: boolean) => void;

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);

function usePlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: os,
  });
}

function mockPreferenceQueries() {
  return {
    boldText: jest
      .spyOn(AccessibilityInfo, "isBoldTextEnabled")
      .mockResolvedValue(false),
    darkerSystemColors: jest
      .spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled")
      .mockResolvedValue(false),
    grayscale: jest
      .spyOn(AccessibilityInfo, "isGrayscaleEnabled")
      .mockResolvedValue(false),
    highTextContrast: jest
      .spyOn(AccessibilityInfo, "isHighTextContrastEnabled")
      .mockResolvedValue(false),
    invertColors: jest
      .spyOn(AccessibilityInfo, "isInvertColorsEnabled")
      .mockResolvedValue(false),
    reduceMotion: jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false),
    reduceTransparency: jest
      .spyOn(AccessibilityInfo, "isReduceTransparencyEnabled")
      .mockResolvedValue(false),
  };
}

function capturePreferenceListeners() {
  const listeners = new Map<string, ChangeHandler>();
  const removers: jest.Mock[] = [];

  const subscribe: SubscribeToAccessibilityPreference = (
    eventName,
    handler,
  ) => {
    const remove = jest.fn();

    listeners.set(eventName, handler);
    removers.push(remove);

    return { remove };
  };

  return { listeners, removers, subscribe };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  if (originalPlatformDescriptor) {
    Object.defineProperty(Platform, "OS", originalPlatformDescriptor);
  }
});

describe("useAccessibilityPreferences", () => {
  it("queries, subscribes, updates, and cleans up iOS preferences", async () => {
    usePlatform("ios");
    const queries = mockPreferenceQueries();
    queries.boldText.mockResolvedValue(true);
    queries.grayscale.mockResolvedValue(true);
    queries.reduceTransparency.mockResolvedValue(true);
    queries.darkerSystemColors.mockResolvedValue(true);
    let resolveReduceMotion: ((enabled: boolean) => void) | undefined;
    queries.reduceMotion.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReduceMotion = resolve;
        }),
    );
    const { listeners, removers, subscribe } = capturePreferenceListeners();

    const { result, unmount } = await renderHook(() =>
      useAccessibilityPreferences(subscribe),
    );

    expect(result.current.reduceMotion).toBe(true);
    expect(result.current.isReady).toBe(false);

    await act(() => resolveReduceMotion?.(false));
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current).toEqual({
      reduceMotion: false,
      boldText: true,
      grayscale: true,
      invertColors: false,
      reduceTransparency: true,
      darkerSystemColors: true,
      highTextContrast: false,
      isReady: true,
    });
    expect([...listeners.keys()].sort()).toEqual(
      [
        "boldTextChanged",
        "darkerSystemColorsChanged",
        "grayscaleChanged",
        "invertColorsChanged",
        "reduceMotionChanged",
        "reduceTransparencyChanged",
      ].sort(),
    );
    expect(queries.highTextContrast).not.toHaveBeenCalled();

    await act(() => listeners.get("boldTextChanged")?.(false));
    expect(result.current.boldText).toBe(false);

    await unmount();
    expect(removers).toHaveLength(6);
    removers.forEach((remove) => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("uses Android high contrast and preserves a newer event over a stale query", async () => {
    usePlatform("android");
    const queries = mockPreferenceQueries();
    let resolveReduceMotion: ((enabled: boolean) => void) | undefined;
    queries.reduceMotion.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReduceMotion = resolve;
        }),
    );
    queries.highTextContrast.mockResolvedValue(true);
    const { listeners, removers, subscribe } = capturePreferenceListeners();

    const { result, unmount } = await renderHook(() =>
      useAccessibilityPreferences(subscribe),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect([...listeners.keys()].sort()).toEqual(
      ["highTextContrastChanged", "reduceMotionChanged"].sort(),
    );
    expect(queries.boldText).not.toHaveBeenCalled();
    expect(queries.darkerSystemColors).not.toHaveBeenCalled();
    expect(queries.reduceTransparency).not.toHaveBeenCalled();
    expect(queries.grayscale).not.toHaveBeenCalled();
    expect(queries.invertColors).not.toHaveBeenCalled();

    await act(() => listeners.get("reduceMotionChanged")?.(true));
    await act(() => resolveReduceMotion?.(false));

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.reduceMotion).toBe(true);
    expect(result.current.highTextContrast).toBe(true);

    await unmount();
    expect(removers).toHaveLength(2);
    removers.forEach((remove) => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("fails safely when the native Reduce Motion query is unavailable", async () => {
    usePlatform("ios");
    const queries = mockPreferenceQueries();
    queries.reduceMotion.mockRejectedValue(new Error("native API unavailable"));
    const { subscribe } = capturePreferenceListeners();

    const { result } = await renderHook(() =>
      useAccessibilityPreferences(subscribe),
    );

    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.reduceMotion).toBe(true);
  });
});

describe("getNonessentialMotionDuration", () => {
  it("removes nonessential motion when the preference is enabled", () => {
    expect(getNonessentialMotionDuration(true, 350)).toBe(0);
  });

  it("uses a nonnegative requested duration otherwise", () => {
    expect(getNonessentialMotionDuration(false)).toBe(
      DEFAULT_NONESSENTIAL_MOTION_DURATION_MS,
    );
    expect(getNonessentialMotionDuration(false, 350)).toBe(350);
    expect(getNonessentialMotionDuration(false, -1)).toBe(0);
  });
});
