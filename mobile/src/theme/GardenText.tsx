import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";

import { fonts, type GardenFonts } from "./fonts";
import { useGardenTheme } from "./GardenThemeProvider";
import type { GardenColorToken } from "./tokens";

export type GardenTextVariant =
  | "hero"
  | "screenTitle"
  | "sectionTitle"
  | "cardTitle"
  | "intro"
  | "body"
  | "metadata"
  | "eyebrow";

type ScalingProps =
  | "adjustsFontSizeToFit"
  | "allowFontScaling"
  | "maxFontSizeMultiplier"
  | "numberOfLines";

export interface GardenTextProps extends Omit<TextProps, ScalingProps> {
  color?: GardenColorToken;
  variant?: GardenTextVariant;
}

const displayTextMaxMultipliers: Partial<Record<GardenTextVariant, number>> = {
  hero: 1.5,
  cardTitle: 2,
};

const defaultFontFamilies: Record<GardenTextVariant, keyof GardenFonts> = {
  hero: "displayBold",
  screenTitle: "displayBold",
  sectionTitle: "displaySemiBold",
  cardTitle: "displaySemiBold",
  intro: "bodyRegular",
  body: "bodyRegular",
  metadata: "monoMedium",
  eyebrow: "monoSemiBold",
};

const boldTextFontFamilies: Record<GardenTextVariant, keyof GardenFonts> = {
  hero: "displayBold",
  screenTitle: "displayBold",
  sectionTitle: "displayBold",
  cardTitle: "displayBold",
  intro: "bodySemiBold",
  body: "bodySemiBold",
  metadata: "monoSemiBold",
  eyebrow: "monoSemiBold",
};

export function getGardenTextFontFamily(
  variant: GardenTextVariant,
  boldText: boolean,
  gardenFonts: GardenFonts = fonts,
  requestedFontFamily?: string,
): string {
  if (boldText && requestedFontFamily !== undefined) {
    if (
      requestedFontFamily === gardenFonts.bodyRegular ||
      requestedFontFamily === gardenFonts.bodyMedium
    ) {
      return gardenFonts.bodySemiBold;
    }
    if (requestedFontFamily === gardenFonts.bodySemiBold) {
      return gardenFonts.bodyBold;
    }
    if (requestedFontFamily === gardenFonts.displaySemiBold) {
      return gardenFonts.displayBold;
    }
    if (requestedFontFamily === gardenFonts.monoMedium) {
      return gardenFonts.monoSemiBold;
    }

    return requestedFontFamily;
  }

  const fontToken = (boldText ? boldTextFontFamilies : defaultFontFamilies)[
    variant
  ];

  return gardenFonts[fontToken];
}

export function GardenText({
  color = "foreground",
  style,
  variant = "body",
  ...textProps
}: GardenTextProps) {
  const {
    accessibilityPreferences,
    colors,
    fonts: gardenFonts,
  } = useGardenTheme();
  const maxFontSizeMultiplier = displayTextMaxMultipliers[variant];
  const requestedFontFamily = StyleSheet.flatten(style)?.fontFamily;
  const fontFamily = getGardenTextFontFamily(
    variant,
    accessibilityPreferences.boldText,
    gardenFonts,
    requestedFontFamily,
  );

  return (
    <Text
      {...textProps}
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        variantStyles[variant],
        { color: colors[color], fontFamily },
        style,
        accessibilityPreferences.boldText ? { fontFamily } : undefined,
      ]}
    />
  );
}

const variantStyles = StyleSheet.create<Record<GardenTextVariant, TextStyle>>({
  hero: {
    fontSize: 38,
    letterSpacing: -0.76,
    lineHeight: 44,
  },
  screenTitle: {
    fontSize: 32,
    letterSpacing: -0.64,
    lineHeight: 37,
  },
  sectionTitle: {
    fontSize: 24,
    letterSpacing: -0.24,
    lineHeight: 30,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
  },
  intro: {
    fontSize: 18,
    lineHeight: 29,
  },
  body: {
    fontSize: 16,
    lineHeight: 26,
  },
  metadata: {
    fontSize: 13,
    letterSpacing: 0.13,
    lineHeight: 20,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.68,
    lineHeight: 18,
    textTransform: "uppercase",
  },
});
