import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { getGardenFonts } from "../theme/fonts";
import type { NativePlaybackRate } from "./NativePlaybackRate";
import { NativePlaybackSpeedControl } from "./NativePlaybackSpeedControl";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);
const originalAnnouncementOptionsDescriptor = Object.getOwnPropertyDescriptor(
  AccessibilityInfo,
  "announceForAccessibilityWithOptions",
);

function setPlatformOS(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: os,
  });
}

function control({
  disabled = false,
  onChange = () => true,
  rate = 1,
}: {
  disabled?: boolean;
  onChange?: (next: NativePlaybackRate) => boolean;
  rate?: NativePlaybackRate;
} = {}) {
  return (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <NativePlaybackSpeedControl
        disabled={disabled}
        onChange={onChange}
        rate={rate}
        testID="playback-speed"
      />
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

describe("NativePlaybackSpeedControl", () => {
  it("exposes one compact, reflow-safe button with the current and next rates", () => {
    render(control());

    const button = screen.getByRole("button", {
      name: "Playback speed 1x",
    });
    const label = screen.getByText("1x");
    const buttonStyle = StyleSheet.flatten(button.props.style);
    const labelStyle = StyleSheet.flatten(label.props.style);

    expect(button).toHaveProp("accessibilityHint", "Changes to 1.25x.");
    expect(button).toHaveProp("accessibilityState", { disabled: false });
    expect(button).toHaveProp("focusable", true);
    expect(buttonStyle).toMatchObject({
      alignSelf: "flex-end",
      backgroundColor: "transparent",
      borderColor: "#7a8273",
      borderRadius: 8,
      borderWidth: 2,
      minHeight: 48,
      minWidth: 48,
    });
    expect(buttonStyle.height).toBeUndefined();
    expect(buttonStyle.width).toBeUndefined();
    expect(label).toHaveProp("accessible", false);
    expect(label).toHaveProp("allowFontScaling", true);
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).toBeUndefined();
    expect(labelStyle).toMatchObject({
      color: "#516247",
      fontFamily: getGardenFonts().monoSemiBold,
    });
  });

  it("retains visible focus while disabled and ignores activation", () => {
    const onChange = jest.fn((_next: NativePlaybackRate) => true);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    render(control({ disabled: true, onChange }));
    const button = screen.getByRole("button", {
      disabled: true,
      name: "Playback speed 1x",
    });
    const label = screen.getByText("1x");

    expect(button).toHaveProp("focusable", true);
    expect(button).not.toHaveProp("accessibilityHint");
    fireEvent(button, "focus");
    const buttonStyle = StyleSheet.flatten(button.props.style);
    expect(buttonStyle).toMatchObject({
      outlineColor: "#036b4a",
      outlineOffset: 2,
      outlineStyle: "solid",
      outlineWidth: 3,
    });
    expect(buttonStyle.opacity).toBeUndefined();
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({
      opacity: 0.55,
    });

    fireEvent.press(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("cycles rapid accepted presses from the latest requested rate and keeps focus", () => {
    setPlatformOS("ios");
    const onChange = jest.fn((_next: NativePlaybackRate) => true);
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const view = render(control({ onChange }));
    const button = screen.getByTestId("playback-speed");
    fireEvent(button, "focus");

    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(onChange.mock.calls.map(([rate]) => rate)).toEqual([1.25, 1.5]);
    expect(announceWithOptions).not.toHaveBeenCalled();
    view.rerender(control({ onChange, rate: 1.5 }));
    expect(screen.getByRole("button", { name: "Playback speed 1.5x" })).toBe(
      button,
    );
    expect(screen.getByTestId("playback-speed")).toHaveProp(
      "accessibilityHint",
      "Changes to 1.75x.",
    );
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      outlineOffset: 2,
      outlineStyle: "solid",
      outlineWidth: 3,
    });
    expect(
      StyleSheet.flatten(screen.getByText("1.5x").props.style),
    ).toMatchObject({
      color: "#036b4a",
      textDecorationLine: "underline",
    });
    expect(announceWithOptions).toHaveBeenCalledTimes(1);
    expect(announceWithOptions).toHaveBeenCalledWith("Playback speed 1.5x.", {
      priority: "low",
      queue: true,
    });
  });

  it("announces an accepted iOS change only after its controlled prop commits", () => {
    setPlatformOS("ios");
    const onChange = jest.fn((_next: NativePlaybackRate) => true);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const view = render(control({ onChange }));

    expect(announce).not.toHaveBeenCalled();
    expect(announceWithOptions).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("playback-speed"));
    expect(onChange).toHaveBeenCalledWith(1.25);
    expect(announceWithOptions).not.toHaveBeenCalled();

    view.rerender(control({ onChange, rate: 1.25 }));
    expect(announceWithOptions).toHaveBeenCalledTimes(1);
    expect(announceWithOptions).toHaveBeenCalledWith("Playback speed 1.25x.", {
      priority: "low",
      queue: true,
    });
    expect(announce).not.toHaveBeenCalled();

    view.rerender(control({ onChange, rate: 1.5 }));
    expect(announceWithOptions).toHaveBeenCalledTimes(1);
  });

  it("uses one imperative Android announcement and wraps 2x to 0.5x", () => {
    setPlatformOS("android");
    const onChange = jest.fn((_next: NativePlaybackRate) => true);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const view = render(control({ onChange, rate: 2 }));
    const button = screen.getByRole("button", {
      name: "Playback speed 2x",
    });

    expect(button).toHaveProp("accessibilityHint", "Changes to 0.5x.");
    fireEvent.press(button);
    expect(onChange).toHaveBeenCalledWith(0.5);
    expect(announce).not.toHaveBeenCalled();

    view.rerender(control({ onChange, rate: 0.5 }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Playback speed 0.5x.");
    expect(announceWithOptions).not.toHaveBeenCalled();
  });

  it("keeps the prior rate silent when the requested change is rejected", () => {
    setPlatformOS("ios");
    const onChange = jest.fn((_next: NativePlaybackRate) => false);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceWithOptions = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const view = render(control({ onChange }));

    fireEvent.press(screen.getByTestId("playback-speed"));
    expect(onChange).toHaveBeenCalledWith(1.25);
    expect(
      screen.getByRole("button", { name: "Playback speed 1x" }),
    ).toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
    expect(announceWithOptions).not.toHaveBeenCalled();

    view.rerender(control({ onChange, rate: 1.25 }));
    expect(announce).not.toHaveBeenCalled();
    expect(announceWithOptions).not.toHaveBeenCalled();
  });
});
