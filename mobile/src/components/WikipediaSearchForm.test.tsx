import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { WikipediaSearchForm } from "./WikipediaSearchForm";

function renderForm(onSubmit = jest.fn(), initialValue = "") {
  render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <WikipediaSearchForm defaultValue={initialValue} onSubmit={onSubmit} />
    </GardenThemeProvider>,
  );

  return { input: screen.getByLabelText("Search topic"), onSubmit };
}

describe("WikipediaSearchForm", () => {
  it("has a persistent visible label and an uncapped, reflow-safe input", () => {
    const { input } = renderForm();

    expect(screen.getByText("Search topic")).toHaveProp("accessible", false);
    expect(input).toHaveProp(
      "accessibilityLabelledBy",
      "wikipedia-search-topic-label",
    );
    expect(
      screen.queryByRole("text", { name: "Search topic" }),
    ).not.toBeOnTheScreen();
    expect(input).toHaveProp("returnKeyType", "search");
    expect(input).toHaveProp("placeholder", "Try orchids");
    expect(input).toHaveProp("allowFontScaling", true);
    expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    expect(input.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(input.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    expect(screen.getByRole("button", { name: "Search" })).toBeOnTheScreen();
  });

  it.each(["press", "submitEditing"] as const)(
    "submits a normalized term from %s",
    (eventName) => {
      const onSubmit = jest.fn();
      const { input } = renderForm(onSubmit);
      fireEvent.changeText(input, "  Ada   Lovelace  ");

      if (eventName === "press") {
        fireEvent.press(screen.getByRole("button", { name: "Search" }));
      } else {
        fireEvent(input, "submitEditing");
      }

      expect(onSubmit).toHaveBeenCalledWith("Ada Lovelace");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    },
  );

  it("announces one non-color error instead of submitting an empty topic", () => {
    const onSubmit = jest.fn();
    const announce = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    const { input } = renderForm(onSubmit);

    fireEvent.changeText(input, "   ");
    fireEvent(input, "submitEditing");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alert", {
        name: "Enter a topic to search Wikipedia.",
      }),
    ).toBeOnTheScreen();
    expect(input.props.accessibilityHint).toContain("required");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Enter a topic to search Wikipedia.",
      { queue: true, priority: "low" },
    );

    announce.mockRestore();
  });
});
