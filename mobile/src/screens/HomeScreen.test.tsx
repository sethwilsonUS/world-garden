import { fireEvent, render, screen } from "@testing-library/react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { HomeScreen } from "./HomeScreen";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function renderScreen() {
  return render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <HomeScreen />
    </GardenThemeProvider>,
  );
}

describe("HomeScreen", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("mirrors the current web search workbench without placeholder features", () => {
    renderScreen();

    expect(
      screen.getByRole("header", { name: "Curio Garden" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Explore any Wikipedia article as clear, section-by-section audio, then keep listening wherever curiosity takes you.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Your next curiosity")).toBeOnTheScreen();
    expect(
      screen.getByRole("header", {
        name: "Find a topic. Follow the thread.",
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Search any Wikipedia article, then choose the sections you want to hear.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("No account needed to begin.")).toBeOnTheScreen();
    expect(screen.queryByText(/foundation ready/i)).not.toBeOnTheScreen();
  });

  it("navigates an explicit search using the canonical search route", () => {
    renderScreen();
    const input = screen.getByLabelText("Search topic");

    fireEvent.changeText(input, "  Bossa   nova ");
    fireEvent.press(screen.getByRole("button", { name: "Search" }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/search",
      params: { q: "Bossa nova" },
    });
  });

  it("opens account access without displacing the public search task", () => {
    renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Account" }));

    expect(mockPush).toHaveBeenCalledWith("/account");
    expect(screen.getByLabelText("Search topic")).toBeOnTheScreen();
  });

  it("opens the account Library without displacing the public search task", () => {
    renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Library" }));

    expect(mockPush).toHaveBeenCalledWith("/library");
    expect(screen.getByLabelText("Search topic")).toBeOnTheScreen();
  });
});
