import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import {
  Platform,
  useColorScheme,
  type ColorSchemeName,
  type PlatformOSType,
} from "react-native";

import {
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  useAccessibilityPreferences,
  type AccessibilityPreferences,
} from "../accessibility/useAccessibilityPreferences";
import { fonts, getGardenFonts, type GardenFonts } from "./fonts";
import {
  gardenColors,
  radii,
  spacing,
  type GardenColors,
  type GardenColorScheme,
} from "./tokens";

interface NavigationFontStyle {
  fontFamily: string;
  fontWeight: "normal" | "400" | "500" | "700";
}

export interface GardenNavigationTheme {
  dark: boolean;
  colors: {
    background: string;
    border: string;
    card: string;
    notification: string;
    primary: string;
    text: string;
  };
  fonts: {
    bold: NavigationFontStyle;
    heavy: NavigationFontStyle;
    medium: NavigationFontStyle;
    regular: NavigationFontStyle;
  };
}

export function resolveGardenColorScheme(
  colorScheme: ColorSchemeName | null | undefined,
): GardenColorScheme {
  return colorScheme === "dark" ? "dark" : "light";
}

export function getGardenNavigationTheme(
  colorScheme: GardenColorScheme,
  platform: PlatformOSType = Platform.OS,
  colors: GardenColors = gardenColors[colorScheme],
): GardenNavigationTheme {
  const navigationFonts = getGardenFonts(platform);
  const fontWeight = <Weight extends "400" | "500" | "700">(
    weight: Weight,
  ): Weight | "normal" => (platform === "android" ? "normal" : weight);

  return {
    dark: colorScheme === "dark",
    colors: {
      primary: colors.accent,
      background: colors.surface,
      card: colors.surface,
      text: colors.foreground,
      border: colors.border,
      notification: colors.critical,
    },
    fonts: {
      regular: {
        fontFamily: navigationFonts.bodyRegular,
        fontWeight: fontWeight("400"),
      },
      medium: {
        fontFamily: navigationFonts.bodyMedium,
        fontWeight: fontWeight("500"),
      },
      bold: {
        fontFamily: navigationFonts.bodyBold,
        fontWeight: fontWeight("700"),
      },
      heavy: {
        fontFamily: navigationFonts.bodyBold,
        fontWeight: fontWeight("700"),
      },
    },
  };
}

/**
 * Increase Contrast / High Contrast strengthen secondary text and boundaries
 * while leaving the current site-derived palette untouched by default.
 */
export function getGardenColors(
  colorScheme: GardenColorScheme,
  increasedContrast: boolean,
): GardenColors {
  const colors = gardenColors[colorScheme];

  if (!increasedContrast) {
    return colors;
  }

  return {
    ...colors,
    foreground2: colors.foreground,
    muted: colors.foreground,
    border: colors.controlBorder,
    controlBorder: colors.foreground2,
    accentBorder: colors.accent,
  };
}

export interface GardenThemeValue {
  accessibilityPreferences: AccessibilityPreferences;
  colorScheme: GardenColorScheme;
  colors: GardenColors;
  fonts: GardenFonts;
  increasedContrast: boolean;
  isDark: boolean;
  navigationTheme: GardenNavigationTheme;
  radii: typeof radii;
  spacing: typeof spacing;
}

const GardenThemeContext = createContext<GardenThemeValue | null>(null);

export interface GardenThemeProviderProps extends PropsWithChildren {
  /** A deterministic override for previews and tests; production follows the OS. */
  colorSchemeOverride?: ColorSchemeName;
  /** A deterministic override for accessibility previews and tests. */
  accessibilityPreferencesOverride?: Partial<AccessibilityPreferences>;
}

interface ResolvedGardenThemeProviderProps extends PropsWithChildren {
  accessibilityPreferences: AccessibilityPreferences;
  colorSchemeOverride?: ColorSchemeName;
}

function ResolvedGardenThemeProvider({
  accessibilityPreferences,
  children,
  colorSchemeOverride,
}: ResolvedGardenThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const colorScheme = resolveGardenColorScheme(
    colorSchemeOverride ?? systemColorScheme,
  );
  const increasedContrast =
    accessibilityPreferences.darkerSystemColors ||
    accessibilityPreferences.highTextContrast;

  const value = useMemo<GardenThemeValue>(() => {
    const colors = getGardenColors(colorScheme, increasedContrast);

    return {
      accessibilityPreferences,
      colorScheme,
      colors,
      fonts,
      increasedContrast,
      isDark: colorScheme === "dark",
      navigationTheme: getGardenNavigationTheme(
        colorScheme,
        Platform.OS,
        colors,
      ),
      radii,
      spacing,
    };
  }, [accessibilityPreferences, colorScheme, increasedContrast]);

  return (
    <GardenThemeContext.Provider value={value}>
      {children}
    </GardenThemeContext.Provider>
  );
}

function SystemAccessibilityGardenThemeProvider({
  children,
  colorSchemeOverride,
}: Omit<GardenThemeProviderProps, "accessibilityPreferencesOverride">) {
  const accessibilityPreferences = useAccessibilityPreferences();

  return (
    <ResolvedGardenThemeProvider
      accessibilityPreferences={accessibilityPreferences}
      colorSchemeOverride={colorSchemeOverride}
    >
      {children}
    </ResolvedGardenThemeProvider>
  );
}

export function GardenThemeProvider({
  accessibilityPreferencesOverride,
  children,
  colorSchemeOverride,
}: GardenThemeProviderProps) {
  if (accessibilityPreferencesOverride !== undefined) {
    const accessibilityPreferences: AccessibilityPreferences = {
      ...DEFAULT_ACCESSIBILITY_PREFERENCES,
      isReady: true,
      ...accessibilityPreferencesOverride,
    };

    return (
      <ResolvedGardenThemeProvider
        accessibilityPreferences={accessibilityPreferences}
        colorSchemeOverride={colorSchemeOverride}
      >
        {children}
      </ResolvedGardenThemeProvider>
    );
  }

  return (
    <SystemAccessibilityGardenThemeProvider
      colorSchemeOverride={colorSchemeOverride}
    >
      {children}
    </SystemAccessibilityGardenThemeProvider>
  );
}

export function useGardenTheme(): GardenThemeValue {
  const value = useContext(GardenThemeContext);

  if (value === null) {
    throw new Error("useGardenTheme must be used within GardenThemeProvider");
  }

  return value;
}
