import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  GardenThemeProvider,
  getGardenColors,
  getGardenNavigationTheme,
  resolveGardenColorScheme,
  useGardenTheme,
} from "./GardenThemeProvider";
import { gardenColors } from "./tokens";

describe("GardenThemeProvider", () => {
  it("resolves missing system preferences to light", () => {
    expect(resolveGardenColorScheme(null)).toBe("light");
    expect(resolveGardenColorScheme(undefined)).toBe("light");
    expect(resolveGardenColorScheme("dark")).toBe("dark");
  });

  it("provides a deterministic theme override for tests and previews", () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="dark"
      >
        {children}
      </GardenThemeProvider>
    );
    const { result } = renderHook(() => useGardenTheme(), { wrapper });

    expect(result.current.colorScheme).toBe("dark");
    expect(result.current.isDark).toBe(true);
    expect(result.current.colors.surface).toBe("#171717");
    expect(result.current.navigationTheme.dark).toBe(true);
  });

  it("fails clearly when the hook is used outside its provider", () => {
    expect(() => renderHook(() => useGardenTheme())).toThrow(
      "useGardenTheme must be used within GardenThemeProvider",
    );
  });

  it("keeps the exact site-derived palette when increased contrast is off", () => {
    expect(getGardenColors("light", false)).toBe(gardenColors.light);
    expect(getGardenColors("dark", false)).toBe(gardenColors.dark);
  });

  it.each(["darkerSystemColors", "highTextContrast"] as const)(
    "strengthens secondary text and boundaries for %s",
    (preference) => {
      const wrapper = ({ children }: PropsWithChildren) => (
        <GardenThemeProvider
          accessibilityPreferencesOverride={{ [preference]: true }}
          colorSchemeOverride="light"
        >
          {children}
        </GardenThemeProvider>
      );
      const { result } = renderHook(() => useGardenTheme(), { wrapper });

      expect(result.current.increasedContrast).toBe(true);
      expect(result.current.colors).toMatchObject({
        surface: "#f7f6f3",
        foreground: "#1a1a1a",
        foreground2: "#1a1a1a",
        muted: "#1a1a1a",
        border: "#7a8273",
        controlBorder: "#4b5441",
        accentBorder: "#036b4a",
      });
      expect(result.current.navigationTheme.colors.border).toBe("#7a8273");
    },
  );

  it("maps semantic colors and exact iOS PostScript font names", () => {
    expect(getGardenNavigationTheme("light", "ios")).toMatchObject({
      dark: false,
      colors: {
        primary: "#036b4a",
        background: "#f7f6f3",
        card: "#f7f6f3",
        text: "#1a1a1a",
        border: "#d4d1c7",
        notification: "#b91c1c",
      },
      fonts: {
        regular: { fontFamily: "DMSans-Regular", fontWeight: "400" },
        medium: { fontFamily: "DMSans-Medium", fontWeight: "500" },
        bold: { fontFamily: "DMSans-Bold", fontWeight: "700" },
      },
    });
  });

  it("does not ask Android to resolve a second weight within a font-file family", () => {
    expect(getGardenNavigationTheme("dark", "android").fonts).toEqual({
      regular: {
        fontFamily: "DMSans_400Regular",
        fontWeight: "normal",
      },
      medium: {
        fontFamily: "DMSans_500Medium",
        fontWeight: "normal",
      },
      bold: {
        fontFamily: "DMSans_700Bold",
        fontWeight: "normal",
      },
      heavy: {
        fontFamily: "DMSans_700Bold",
        fontWeight: "normal",
      },
    });
  });
});
