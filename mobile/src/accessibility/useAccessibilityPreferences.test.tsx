import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import {
  DEFAULT_NONESSENTIAL_MOTION_DURATION_MS,
  getNonessentialMotionDuration,
  useAccessibilityPreferences,
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

  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    eventName: string,
    handler: ChangeHandler,
  ) => {
    const remove = jest.fn();

    listeners.set(eventName, handler);
    removers.push(remove);

    return { remove } as unknown as ReturnType<
      typeof AccessibilityInfo.addEventListener
    >;
  }) as typeof AccessibilityInfo.addEventListener);

  return { listeners, removers };
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
    const { listeners, removers } = capturePreferenceListeners();

    const { result, unmount } = renderHook(() => useAccessibilityPreferences());

    expect(result.current.reduceMotion).toBe(true);
    expect(result.current.isReady).toBe(false);

    await act(async () => {
      await Promise.resolve();
    });
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

    act(() => listeners.get("boldTextChanged")?.(false));
    expect(result.current.boldText).toBe(false);

    unmount();
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
    const { listeners, removers } = capturePreferenceListeners();

    const { result, unmount } = renderHook(() => useAccessibilityPreferences());

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

    act(() => listeners.get("reduceMotionChanged")?.(true));
    act(() => resolveReduceMotion?.(false));

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.reduceMotion).toBe(true);
    expect(result.current.highTextContrast).toBe(true);

    unmount();
    expect(removers).toHaveLength(2);
    removers.forEach((remove) => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("fails safely when the native Reduce Motion query is unavailable", async () => {
    usePlatform("ios");
    const queries = mockPreferenceQueries();
    queries.reduceMotion.mockRejectedValue(new Error("native API unavailable"));
    capturePreferenceListeners();

    const { result } = renderHook(() => useAccessibilityPreferences());

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
