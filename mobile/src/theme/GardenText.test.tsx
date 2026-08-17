import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenText, type GardenTextVariant } from "./GardenText";
import { GardenThemeProvider } from "./GardenThemeProvider";

async function renderText(variant: GardenTextVariant, boldText = false) {
  await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{ boldText }}
      colorSchemeOverride="light"
    >
      <GardenText variant={variant}>{variant}</GardenText>
    </GardenThemeProvider>,
  );

  return screen.getByText(variant);
}

describe("GardenText", () => {
  it.each([
    ["hero", "Fraunces-Bold", 1.5],
    ["screenTitle", "Fraunces-Bold", 2],
    ["sectionTitle", "Fraunces-SemiBold", undefined],
    ["cardTitle", "Fraunces-SemiBold", 2],
    ["intro", "DMSans-Regular", undefined],
    ["body", "DMSans-Regular", undefined],
    ["metadata", "JetBrainsMono-Medium", undefined],
    ["eyebrow", "JetBrainsMono-SemiBold", undefined],
  ] as const)(
    "uses the real font file and intended scaling policy for %s",
    async (variant, fontFamily, maxFontSizeMultiplier) => {
      const text = await renderText(variant);
      const style = StyleSheet.flatten(text.props.style);

      expect(style.fontFamily).toBe(fontFamily);
      expect(text).toHaveProp("allowFontScaling", true);
      if (maxFontSizeMultiplier === undefined) {
        expect(text.props).not.toHaveProperty("maxFontSizeMultiplier");
      } else {
        expect(text).toHaveProp("maxFontSizeMultiplier", maxFontSizeMultiplier);
      }
      expect(text.props).not.toHaveProperty("numberOfLines");
      expect(text.props).not.toHaveProperty("adjustsFontSizeToFit");
    },
  );

  it("uses semantic theme colors without weakening caller semantics", async () => {
    await render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="dark"
      >
        <GardenText
          accessibilityRole="header"
          color="accent"
          variant="sectionTitle"
        >
          Listen next
        </GardenText>
      </GardenThemeProvider>,
    );

    const heading = screen.getByRole("header", { name: "Listen next" });
    expect(StyleSheet.flatten(heading.props.style).color).toBe("#34d399");
  });

  it.each([
    ["hero", "Fraunces-Bold"],
    ["screenTitle", "Fraunces-Bold"],
    ["sectionTitle", "Fraunces-Bold"],
    ["cardTitle", "Fraunces-Bold"],
    ["intro", "DMSans-SemiBold"],
    ["body", "DMSans-SemiBold"],
    ["metadata", "JetBrainsMono-SemiBold"],
    ["eyebrow", "JetBrainsMono-SemiBold"],
  ] as const)("honors Bold Text for %s", async (variant, fontFamily) => {
    const text = await renderText(variant, true);

    expect(StyleSheet.flatten(text.props.style).fontFamily).toBe(fontFamily);
  });

  it("promotes an explicitly semibold body style only when Bold Text is on", async () => {
    const content = (boldText: boolean) => (
      <GardenThemeProvider
        accessibilityPreferencesOverride={{ boldText }}
        colorSchemeOverride="light"
      >
        <GardenText style={{ fontFamily: "DMSans-SemiBold" }}>
          Button label
        </GardenText>
      </GardenThemeProvider>
    );
    const { rerender } = await render(content(false));

    expect(
      StyleSheet.flatten(screen.getByText("Button label").props.style)
        .fontFamily,
    ).toBe("DMSans-SemiBold");

    await rerender(content(true));

    expect(
      StyleSheet.flatten(screen.getByText("Button label").props.style)
        .fontFamily,
    ).toBe("DMSans-Bold");
  });
});
