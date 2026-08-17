import { fireEvent, render, screen } from "@testing-library/react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { InvalidArticleLinkScreen } from "./InvalidArticleLinkScreen";

describe("InvalidArticleLinkScreen", () => {
  it("explains the invalid route and offers a full-size return control", async () => {
    const onBack = jest.fn();

    await render(
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
        "This article link is missing a valid title. Return to search and choose an article.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Back to search" }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("names the honest Library return path for an invalid saved link", async () => {
    const onBack = jest.fn();

    await render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <InvalidArticleLinkScreen backLabel="Back to Library" onBack={onBack} />
      </GardenThemeProvider>,
    );

    expect(
      screen.getByText(
        "This saved article link is missing a valid title. Return to your Library and choose another article.",
      ),
    ).toBeOnTheScreen();
    const back = screen.getByRole("button", { name: "Back to Library" });
    expect(back).toHaveProp(
      "accessibilityHint",
      "Returns to your saved articles.",
    );
    await fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
