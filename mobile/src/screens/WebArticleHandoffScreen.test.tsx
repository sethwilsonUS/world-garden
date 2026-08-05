import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { WebArticleHandoffScreen } from "./WebArticleHandoffScreen";

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof WebArticleHandoffScreen>> = {},
) {
  const props = {
    onBack: jest.fn(),
    openArticle: jest.fn().mockResolvedValue(undefined),
    slug: "Ada_Lovelace",
    ...overrides,
  };

  render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <WebArticleHandoffScreen {...props} />
    </GardenThemeProvider>,
  );
  return props;
}

describe("WebArticleHandoffScreen", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("offers an honest, explicit handoff while native reading is built", () => {
    renderScreen();

    expect(
      screen.getAllByRole("header", { name: "Ada Lovelace" }),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        "This article is available now on Curio Garden web. Native article reading is the next mobile slice.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Open article on Curio Garden web",
      }),
    ).toBeOnTheScreen();
  });

  it("opens only the encoded canonical Curio Garden URL", async () => {
    const props = renderScreen({ slug: "AC/DC" });

    fireEvent.press(
      screen.getByRole("button", {
        name: "Open article on Curio Garden web",
      }),
    );

    await waitFor(() =>
      expect(props.openArticle).toHaveBeenCalledWith(
        "https://curiogarden.org/article/AC%2FDC",
      ),
    );
  });

  it("keeps browser failures visible and announces them politely", async () => {
    const announce = jest.spyOn(
      AccessibilityInfo,
      "announceForAccessibilityWithOptions",
    );
    renderScreen({
      openArticle: jest.fn().mockRejectedValue(new Error("browser failed")),
    });

    fireEvent.press(
      screen.getByRole("button", {
        name: "Open article on Curio Garden web",
      }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Could not open the article. Please try again.",
      }),
    ).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Could not open the article. Please try again.",
      { queue: true, priority: "low" },
    );
  });

  it("focuses the route heading once without refocusing for async errors", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focus = jest.fn();
    renderScreen({
      focusHeading: focus,
      openArticle: jest.fn().mockRejectedValue(new Error("browser failed")),
    });

    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));

    fireEvent.press(
      screen.getByRole("button", {
        name: "Open article on Curio Garden web",
      }),
    );
    await screen.findByRole("alert", { name: /Could not open/i });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("provides a full-size return control", () => {
    const props = renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Back to search" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
