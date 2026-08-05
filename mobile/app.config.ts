import type { ConfigContext, ExpoConfig } from "expo/config";

const SURFACE_LIGHT = "#f7f6f3";
const SURFACE_DARK = "#171717";
const ACCENT = "#036b4a";

export const bundledFontFiles = [
  "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  "@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf",
  "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
  "@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf",
  "@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf",
  "@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf",
  "@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf",
] as const;

const appVariants = ["development", "preview", "e2e", "production"] as const;

export type AppVariant = (typeof appVariants)[number];

export type AppIdentity = Readonly<{
  displayName: string;
  identifier: string;
  scheme: string;
}>;

const identities: Record<AppVariant, AppIdentity> = {
  development: {
    displayName: "Curio Garden (Dev)",
    identifier: "org.curiogarden.app.dev",
    scheme: "curiogarden-dev",
  },
  preview: {
    displayName: "Curio Garden (Preview)",
    identifier: "org.curiogarden.app.preview",
    scheme: "curiogarden-preview",
  },
  e2e: {
    displayName: "Curio Garden (E2E)",
    identifier: "org.curiogarden.app.e2e",
    scheme: "curiogarden-e2e",
  },
  production: {
    displayName: "Curio Garden",
    identifier: "org.curiogarden.app",
    scheme: "curiogarden",
  },
};

export const resolveAppVariant = (value: string | undefined): AppVariant => {
  if (value === undefined || value === "") return "development";

  if (appVariants.some((variant) => variant === value)) {
    return value as AppVariant;
  }

  throw new Error(`Unsupported APP_VARIANT "${value}"`);
};

export const getAppIdentity = (variant: AppVariant): AppIdentity =>
  identities[variant];

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveAppVariant(process.env.APP_VARIANT);
  const identity = getAppIdentity(variant);

  return {
    ...config,
    name: identity.displayName,
    slug: "curio-garden",
    owner: "a11ygarden",
    version: "0.1.0",
    platforms: ["ios", "android"],
    orientation: "default",
    scheme: identity.scheme,
    icon: "./assets/icon.png",
    primaryColor: ACCENT,
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: identity.identifier,
      supportsTablet: false,
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: identity.identifier,
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
      adaptiveIcon: {
        backgroundColor: ACCENT,
        foregroundImage: "./assets/adaptive-icon.png",
        monochromeImage: "./assets/adaptive-icon.png",
      },
    },
    plugins: [
      "expo-router",
      [
        "expo-font",
        {
          fonts: bundledFontFiles,
        },
      ],
      [
        "expo-dev-client",
        {
          addGeneratedScheme: variant === "development",
        },
      ],
      [
        "expo-splash-screen",
        {
          backgroundColor: SURFACE_LIGHT,
          image: "./assets/splash-icon.png",
          imageWidth: 160,
          resizeMode: "contain",
          dark: {
            backgroundColor: SURFACE_DARK,
            image: "./assets/splash-icon.png",
          },
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
          },
          android: {
            minSdkVersion: 24,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appVariant: variant,
      eas: {
        projectId: "85f56112-e78d-49c6-9b4c-e5872096a1ea",
      },
    },
  };
};
