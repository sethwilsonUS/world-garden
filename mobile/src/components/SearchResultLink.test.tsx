import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { SearchResultLink } from "./SearchResultLink";

const result = {
  wikiPageId: "123",
  title: "A very long history of Ada Lovelace and analytical engines",
  description:
    "English mathematician and writer whose work followed many curious threads.",
  url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
};

async function renderResult(onPress = jest.fn(), testOnlyPressed = false) {
  await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <SearchResultLink
        onPress={onPress}
        position={2}
        result={result}
        testOnly_pressed={testOnlyPressed}
      />
    </GardenThemeProvider>,
  );

  return { link: screen.getByRole("link"), onPress };
}

describe("SearchResultLink", () => {
  it("is one named link whose name contains all visible text", async () => {
    const { link } = await renderResult();

    expect(link).toHaveAccessibleName(
      `2. ${result.title}: ${result.description}`,
    );
    expect(link).toHaveProp(
      "accessibilityHint",
      "Opens this article in Curio Garden.",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText(result.title)).not.toBeOnTheScreen();
    expect(
      screen.getByText(result.title, { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
  });

  it("preserves a 48-point target and never clamps long text", async () => {
    const { link } = await renderResult();
    const title = screen.getByText(result.title, {
      includeHiddenElements: true,
    });
    const description = screen.getByText(result.description, {
      includeHiddenElements: true,
    });

    expect(StyleSheet.flatten(link.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    for (const text of [title, description]) {
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it("activates on release and adds a non-color pressed cue", async () => {
    const onPress = jest.fn();
    const { link } = await renderResult(onPress, true);

    await fireEvent(link, "pressIn");
    await fireEvent(link, "pressOut");
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);

    expect(StyleSheet.flatten(link.props.style)).toMatchObject({
      transform: [{ translateY: 1 }],
    });
    expect(
      StyleSheet.flatten(
        screen.getByText(result.title, { includeHiddenElements: true }).props
          .style,
      ),
    ).toMatchObject({ textDecorationLine: "underline" });
  });
});
