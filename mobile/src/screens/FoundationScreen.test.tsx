import { render, screen } from "@testing-library/react-native";

import { FoundationScreen } from "./FoundationScreen";

describe("FoundationScreen", () => {
  it("exposes one useful screen heading and the development-client contract", () => {
    render(<FoundationScreen />);

    const heading = screen.getByRole("header", { name: "Curio Garden" });

    expect(heading).toBeOnTheScreen();
    expect(heading).toHaveProp("maxFontSizeMultiplier", 2.25);
    expect(
      screen.getByText("Development client foundation ready."),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Expo Go is optional/i)).toBeOnTheScreen();
  });
});
