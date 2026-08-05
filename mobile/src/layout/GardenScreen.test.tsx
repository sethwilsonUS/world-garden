import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenText } from "../theme/GardenText";
import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { GardenScreen, getScreenHorizontalPadding } from "./GardenScreen";

describe("GardenScreen", () => {
  it("returns web-matched gutters without starving narrow reflow", () => {
    expect(getScreenHorizontalPadding(320)).toBe(16);
    expect(getScreenHorizontalPadding(359)).toBe(16);
    expect(getScreenHorizontalPadding(360)).toBe(24);
  });

  it("uses every safe-area edge and a vertical scroll container", () => {
    render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <GardenScreen testID="home-screen">
          <GardenText>Scrollable content</GardenText>
        </GardenScreen>
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("home-screen")).toHaveProp("edges", {
      top: "additive",
      right: "additive",
      bottom: "additive",
      left: "additive",
    });
    expect(screen.getByTestId("home-screen-scroll")).toHaveProp(
      "horizontal",
      false,
    );
    expect(screen.getByText("Scrollable content")).toBeOnTheScreen();
  });

  it("preserves flexible padding and bottom clearance", () => {
    render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <GardenScreen
          contentContainerStyle={{ paddingBottom: 0, paddingHorizontal: 0 }}
        >
          <GardenText>Content</GardenText>
        </GardenScreen>
      </GardenThemeProvider>,
    );

    expect(
      StyleSheet.flatten(
        screen.getByTestId("garden-screen-scroll").props.contentContainerStyle,
      ),
    ).toMatchObject({
      flexGrow: 1,
      paddingBottom: 64,
      paddingHorizontal: 24,
      paddingTop: 24,
    });
  });
});
