import { contrastRatio, relativeLuminance } from "./contrast";
import { getGardenFonts } from "./fonts";
import { gardenColors, radii, spacing } from "./tokens";

describe("garden theme tokens", () => {
  it("matches the current web palette exactly", () => {
    expect(gardenColors.light).toMatchObject({
      surface: "#f7f6f3",
      surface2: "#efede8",
      surface3: "#e5e2db",
      foreground: "#1a1a1a",
      foreground2: "#4b5441",
      muted: "#516247",
      border: "#d4d1c7",
      controlBorder: "#7a8273",
      accent: "#036b4a",
      btnPrimary: "#036b4a",
      critical: "#b91c1c",
      serious: "#c2410c",
    });
    expect(gardenColors.dark).toMatchObject({
      surface: "#171717",
      surface2: "#1e1e1e",
      surface3: "#2a2a2a",
      foreground: "#f0ede6",
      foreground2: "#a8b89e",
      muted: "#909f86",
      border: "#2f2f2f",
      controlBorder: "#71806b",
      accent: "#34d399",
      btnPrimary: "#047857",
      critical: "#f87171",
      serious: "#f97316",
    });
  });

  it("preserves the current four-point spacing and radius scales", () => {
    expect(spacing).toEqual({
      none: 0,
      hairline: 2,
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 20,
      xxl: 24,
      xxxl: 32,
      huge: 40,
      screen: 48,
      giant: 64,
    });
    expect(radii).toEqual({
      none: 0,
      xs: 2,
      sm: 4,
      md: 6,
      lg: 8,
      xl: 12,
      xxl: 16,
      xxxl: 24,
      xxxxl: 32,
      pill: 999,
    });
  });

  it("uses the file names registered by Android", () => {
    expect(getGardenFonts("android")).toEqual({
      bodyRegular: "DMSans_400Regular",
      bodyMedium: "DMSans_500Medium",
      bodySemiBold: "DMSans_600SemiBold",
      bodyBold: "DMSans_700Bold",
      displaySemiBold: "Fraunces_600SemiBold",
      displayBold: "Fraunces_700Bold",
      monoMedium: "JetBrainsMono_500Medium",
      monoSemiBold: "JetBrainsMono_600SemiBold",
    });
  });

  it("uses the embedded fonts' PostScript names on iOS", () => {
    expect(getGardenFonts("ios")).toEqual({
      bodyRegular: "DMSans-Regular",
      bodyMedium: "DMSans-Medium",
      bodySemiBold: "DMSans-SemiBold",
      bodyBold: "DMSans-Bold",
      displaySemiBold: "Fraunces-SemiBold",
      displayBold: "Fraunces-Bold",
      monoMedium: "JetBrainsMono-Medium",
      monoSemiBold: "JetBrainsMono-SemiBold",
    });
  });
});

describe("WCAG contrast guardrails", () => {
  it("implements the WCAG relative-luminance formula", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000", "#fff")).toBe(21);
    expect(() => contrastRatio("not-a-color", "#ffffff")).toThrow(
      /three- or six-digit hex color/,
    );
  });

  it.each(["light", "dark"] as const)(
    "%s text pairings meet WCAG 2.2 AA for normal text",
    (colorScheme) => {
      const colors = gardenColors[colorScheme];
      const textColors = [
        colors.foreground,
        colors.foreground2,
        colors.muted,
        colors.accent,
        colors.critical,
      ];
      const surfaces = [colors.surface, colors.surface2, colors.surface3];

      for (const textColor of textColors) {
        for (const surface of surfaces) {
          expect(contrastRatio(textColor, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      // The serious status token is approved for the base screen surface. On
      // raised light surfaces it must be paired with an icon/text treatment,
      // rather than used as normal-size text by itself.
      expect(
        contrastRatio(colors.serious, colors.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(colors.btnPrimaryText, colors.btnPrimary),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(colors.btnPrimaryText, colors.btnPrimaryHover),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s essential UI colors meet WCAG 2.2 non-text contrast",
    (colorScheme) => {
      const colors = gardenColors[colorScheme];
      const surfaces = [colors.surface, colors.surface2, colors.surface3];

      for (const surface of surfaces) {
        expect(
          contrastRatio(colors.controlBorder, surface),
        ).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(colors.accent, surface)).toBeGreaterThanOrEqual(3);
      }
      expect(
        contrastRatio(colors.btnPrimary, colors.surface),
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
