import { render, screen } from "@testing-library/react-native";

import { GardenText } from "../theme/GardenText";
import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { GardenCard } from "./GardenCard";

describe("GardenCard", () => {
  it("keeps static card content as separate accessibility stops", () => {
    render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <GardenCard testID="topic-card">
          <GardenText accessibilityRole="header" variant="cardTitle">
            River systems
          </GardenText>
          <GardenText>Follow water from source to sea.</GardenText>
        </GardenCard>
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("topic-card")).toHaveProp("accessible", false);
    expect(
      screen.getByRole("header", { name: "River systems" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Follow water from source to sea."),
    ).toBeOnTheScreen();
  });
});
