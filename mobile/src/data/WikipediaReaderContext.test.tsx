import { render, screen } from "@testing-library/react-native";

import type { WikipediaReader } from "./WikipediaReaderContext";
import {
  useWikipediaReader,
  WikipediaReaderProvider,
} from "./WikipediaReaderContext";
import { GardenText } from "../theme/GardenText";
import { GardenThemeProvider } from "../theme/GardenThemeProvider";

const reader: WikipediaReader = {
  search: jest.fn(),
  fetchArticle: jest.fn(),
};

function Consumer() {
  const value = useWikipediaReader();
  return (
    <GardenText>
      {value === reader ? "Reader ready" : "Wrong reader"}
    </GardenText>
  );
}

describe("WikipediaReaderContext", () => {
  it("provides the injected public reader seam", () => {
    render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <WikipediaReaderProvider reader={reader}>
          <Consumer />
        </WikipediaReaderProvider>
      </GardenThemeProvider>,
    );

    expect(screen.getByText("Reader ready")).toBeOnTheScreen();
  });

  it("fails clearly when a screen escapes the data boundary", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useWikipediaReader() must be used within WikipediaReaderProvider",
    );
  });
});
