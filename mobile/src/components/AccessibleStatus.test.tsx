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
      <AccessibleStatus message={message} testID="status" />
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
  it("activates one polite Android live region without an imperative announcement", () => {
    usePlatform("android");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const { rerender } = render(status(""));

    expect(screen.getByTestId("status")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );

    rerender(status("Saving"));

    expect(screen.getByText("Saving")).toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(screen.getAllByTestId("status")).toHaveLength(1);

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
    const { rerender } = render(status(""));

    expect(screen.getByTestId("status")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(announceWithOptions).not.toHaveBeenCalled();

    rerender(status("Saving"));
    rerender(status("Saving"));
    rerender(status("  Saved  "));
    rerender(status("Saved"));
    rerender(status("   "));

    expect(announceWithOptions).toHaveBeenCalledTimes(2);
    expect(announceWithOptions).toHaveBeenNthCalledWith(1, "Saving", {
      queue: true,
      priority: "low",
    });
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
    const { rerender } = render(status(""));

    rerender(status("Saved"));

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Saved");
  });

  it("does not announce an explicitly hidden message until it becomes active", () => {
    usePlatform("ios");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const content = (accessible: boolean) => (
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <AccessibleStatus accessible={accessible} message="Search failed" />
      </GardenThemeProvider>
    );
    const { rerender } = render(content(false));

    expect(announceWithOptions).not.toHaveBeenCalled();

    rerender(content(true));

    expect(announceWithOptions).toHaveBeenCalledTimes(1);
    expect(announceWithOptions).toHaveBeenCalledWith("Search failed", {
      queue: true,
      priority: "low",
    });
  });
});
