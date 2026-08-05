import { fireEvent, render, screen } from "@testing-library/react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { InvalidArticleLinkScreen } from "./InvalidArticleLinkScreen";

describe("InvalidArticleLinkScreen", () => {
  it("explains the invalid route and offers a full-size return control", () => {
    const onBack = jest.fn();

    render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <InvalidArticleLinkScreen onBack={onBack} />
      </GardenThemeProvider>,
    );

    expect(
      screen.getByRole("header", { name: "Article link unavailable" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "This article link is missing a title. Return to search and choose an article.",
      ),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Back to search" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
