import { render, screen } from "@testing-library/react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { FoundationScreen } from "./FoundationScreen";

function renderScreen() {
  return render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <FoundationScreen />
    </GardenThemeProvider>,
  );
}

describe("FoundationScreen", () => {
  it("exposes one useful screen heading and the signed-build contract", () => {
    renderScreen();

    expect(
      screen.getAllByRole("header", { name: "Curio Garden" }),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        "Explore any Wikipedia article as clear, section-by-section audio, then keep listening wherever curiosity takes you.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Native foundation")).toBeOnTheScreen();
    expect(
      screen.getByText("Development client foundation ready."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Expo Go is optional; signed native builds are the release gate.",
      ),
    ).toBeOnTheScreen();
  });

  it("keeps the foundation informational until the real search slice lands", () => {
    renderScreen();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("foundation-screen-scroll")).toHaveProp(
      "horizontal",
      false,
    );
  });
});
