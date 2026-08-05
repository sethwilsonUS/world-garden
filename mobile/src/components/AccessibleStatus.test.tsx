import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { AccessibleStatus } from "./AccessibleStatus";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);
const originalAnnouncementOptionsDescriptor = Object.getOwnPropertyDescriptor(
  AccessibilityInfo,
  "announceForAccessibilityWithOptions",
);

function usePlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: os,
  });
}

function status(message: string) {
  return (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <AccessibleStatus message={message} />
    </GardenThemeProvider>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  if (originalPlatformDescriptor) {
    Object.defineProperty(Platform, "OS", originalPlatformDescriptor);
  }
  if (originalAnnouncementOptionsDescriptor) {
    Object.defineProperty(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
      originalAnnouncementOptionsDescriptor,
    );
  }
});

describe("AccessibleStatus", () => {
  it("uses one polite Android live region and never makes an imperative announcement", () => {
    usePlatform("android");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const { rerender } = render(status("Saving"));

    expect(screen.getByText("Saving")).toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );

    rerender(status("Saved"));

    expect(screen.getByText("Saved")).toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
    expect(announceWithOptions).not.toHaveBeenCalled();
  });

  it("announces only changed, nonempty iOS messages with polite options", () => {
    usePlatform("ios");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const { rerender } = render(status("Saving"));

    expect(screen.getByText("Saving")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(announceWithOptions).not.toHaveBeenCalled();

    rerender(status("Saving"));
    rerender(status("  Saved  "));
    rerender(status("Saved"));
    rerender(status("   "));

    expect(announceWithOptions).toHaveBeenCalledTimes(1);
    expect(announceWithOptions).toHaveBeenCalledWith("Saved", {
      queue: true,
      priority: "low",
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it("falls back to the basic iOS announcement API", () => {
    usePlatform("ios");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    Object.defineProperty(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
      {
        configurable: true,
        value: undefined,
      },
    );
    const { rerender } = render(status("Saving"));

    rerender(status("Saved"));

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Saved");
  });
});
