import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { getGardenFonts } from "../theme/fonts";
import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { GardenButton } from "./GardenButton";

const buttonProps = {
  hint: "Opens the topic finder",
  label: "Explore a topic",
  onPress: jest.fn(),
};

function renderButton(
  props: Partial<ComponentProps<typeof GardenButton>> = {},
) {
  return render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <GardenButton {...buttonProps} {...props} />
    </GardenThemeProvider>,
  );
}

describe("GardenButton", () => {
  beforeEach(() => {
    buttonProps.onPress.mockClear();
  });

  it("uses its visible label as the accessible button name", () => {
    renderButton();

    const button = screen.getByRole("button", { name: "Explore a topic" });

    expect(button).toHaveProp("accessibilityHint", "Opens the topic finder");
    expect(button).toHaveProp("accessibilityLabel", "Explore a topic");
    expect(button).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
    });
    expect(screen.getByText("Explore a topic")).toHaveTextContent(
      "Explore a topic",
    );
  });

  it("activates only from the release-semantic press event", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Explore a topic" });

    fireEvent(button, "pressIn");
    fireEvent(button, "pressOut");
    expect(buttonProps.onPress).not.toHaveBeenCalled();

    fireEvent.press(button);
    expect(buttonProps.onPress).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "exposes disclosure state without changing its visible name (%s)",
    (expanded) => {
      renderButton({ expanded });

      const button = screen.getByRole("button", { name: "Explore a topic" });
      expect(button).toHaveProp("accessibilityState", {
        busy: false,
        disabled: false,
        expanded,
      });
      expect(screen.getByText("Explore a topic")).toBeOnTheScreen();
    },
  );

  it.each([
    { busy: false, disabled: true },
    { busy: true, disabled: false },
  ])("does not activate while unavailable (%o)", ({ busy, disabled }) => {
    renderButton({ busy, disabled });
    const visibleLabel = busy
      ? "Explore a topic — in progress"
      : "Explore a topic — unavailable";
    const button = screen.getByRole("button", {
      disabled: true,
      name: visibleLabel,
    });

    expect(button).toHaveProp("accessibilityLabel", visibleLabel);
    expect(button).toHaveProp("accessibilityState", {
      busy,
      disabled: true,
    });
    expect(button.props.accessibilityValue?.text).toBeUndefined();
    expect(screen.getByText(visibleLabel)).toBeOnTheScreen();

    fireEvent.press(button);
    expect(buttonProps.onPress).not.toHaveBeenCalled();
  });

  it("keeps a real 48-by-48 target and adds non-color press feedback", () => {
    renderButton({ testOnly_pressed: true });

    const button = screen.getByRole("button", { name: "Explore a topic" });
    const buttonStyle = StyleSheet.flatten(button.props.style);
    const labelStyle = StyleSheet.flatten(
      screen.getByText("Explore a topic").props.style,
    );

    expect(buttonStyle).toMatchObject({
      minHeight: 48,
      minWidth: 48,
      transform: [{ translateY: 1 }],
    });
    expect(labelStyle.fontFamily).toBe(getGardenFonts().bodySemiBold);
    expect(labelStyle).toMatchObject({ textDecorationLine: "underline" });
  });

  it("adds a shape-based focus outline", () => {
    renderButton({ style: { outlineWidth: 0 } });
    const button = screen.getByRole("button", { name: "Explore a topic" });

    fireEvent(button, "focus");

    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      outlineOffset: 2,
      outlineStyle: "solid",
      outlineWidth: 3,
    });
    expect(
      StyleSheet.flatten(screen.getByText("Explore a topic").props.style),
    ).toMatchObject({ textDecorationLine: "underline" });
  });

  it("allows base appearance overrides without weakening the target floor", () => {
    renderButton({
      style: {
        backgroundColor: "#123456",
        borderRadius: 24,
        minHeight: 1,
        paddingVertical: 30,
      },
    });

    expect(
      StyleSheet.flatten(
        screen.getByRole("button", { name: "Explore a topic" }).props.style,
      ),
    ).toMatchObject({
      backgroundColor: "#123456",
      borderRadius: 24,
      minHeight: 48,
      paddingVertical: 30,
    });
  });
});
