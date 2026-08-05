import { Platform, type PlatformOSType } from "react-native";

export interface GardenFonts {
  bodyRegular: string;
  bodyMedium: string;
  bodySemiBold: string;
  bodyBold: string;
  displaySemiBold: string;
  displayBold: string;
  monoMedium: string;
  monoSemiBold: string;
}

const androidFonts: GardenFonts = {
  bodyRegular: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodySemiBold: "DMSans_600SemiBold",
  bodyBold: "DMSans_700Bold",
  displaySemiBold: "Fraunces_600SemiBold",
  displayBold: "Fraunces_700Bold",
  monoMedium: "JetBrainsMono_500Medium",
  monoSemiBold: "JetBrainsMono_600SemiBold",
};

// The expo-font config plugin uses file names on Android and the font files'
// PostScript names on iOS. Keeping that difference explicit avoids a font
// silently falling back on one platform.
const iosFonts: GardenFonts = {
  bodyRegular: "DMSans-Regular",
  bodyMedium: "DMSans-Medium",
  bodySemiBold: "DMSans-SemiBold",
  bodyBold: "DMSans-Bold",
  displaySemiBold: "Fraunces-SemiBold",
  displayBold: "Fraunces-Bold",
  monoMedium: "JetBrainsMono-Medium",
  monoSemiBold: "JetBrainsMono-SemiBold",
};

export function getGardenFonts(
  platform: PlatformOSType = Platform.OS,
): GardenFonts {
  return platform === "android" ? androidFonts : iosFonts;
}

export const fonts = getGardenFonts();
