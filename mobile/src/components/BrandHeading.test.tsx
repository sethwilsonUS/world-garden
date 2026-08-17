import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { BrandHeading } from "./BrandHeading";

async function renderHeading() {
  return await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <BrandHeading />
    </GardenThemeProvider>,
  );
}

describe("BrandHeading", () => {
  it("exposes one heading named Curio Garden without duplicate word stops", async () => {
    await renderHeading();

    expect(
      screen.getAllByRole("header", { name: "Curio Garden" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Curio")).not.toBeOnTheScreen();
    expect(screen.queryByText("Garden")).not.toBeOnTheScreen();
    expect(
      screen.getByText("Curio", { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
    expect(
      screen.getByText("Garden", { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
  });

  it("wraps only between two nonshrinking word units", async () => {
    await renderHeading();

    const wordsStyle = StyleSheet.flatten(
      screen.getByTestId("brand-heading-words", {
        includeHiddenElements: true,
      }).props.style,
    );
    const curio = screen.getByTestId("brand-heading-curio", {
      includeHiddenElements: true,
    });
    const garden = screen.getByTestId("brand-heading-garden", {
      includeHiddenElements: true,
    });

    expect(wordsStyle).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
    });
    for (const word of [curio, garden]) {
      expect(StyleSheet.flatten(word.props.style)).toMatchObject({
        fontSize: 38,
        flexShrink: 0,
      });
      expect(word).toHaveProp("maxFontSizeMultiplier", 1.5);
      expect(word.props.numberOfLines).toBeUndefined();
      expect(word.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });
});
