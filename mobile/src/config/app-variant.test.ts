import { getConfig, type ConfigContext } from "expo/config";
import {
  AndroidConfig,
  compileModsAsync,
  IOSConfig,
} from "expo/config-plugins";

import createAppConfig, {
  bundledFontFiles,
  getAppIdentity,
  resolveAppVariant,
} from "../../app.config";
import easConfig from "../../eas.json";

const configContext = { config: {} } as ConfigContext;
const TEST_CLERK_KEY = "pk_test_Y2kuY3VyaW9nYXJkZW4uaW52YWxpZCQ";
const LIVE_CLERK_KEY = "pk_live_cHJvZHVjdGlvbi5jdXJpb2dhcmRlbi5pbnZhbGlkJA";
const PR_PREVIEW_WEB_ORIGIN =
  "https://world-garden-git-media-sethwilsonus-projects.vercel.app";
const originalAppVariant = process.env.APP_VARIANT;
const originalClerkPublishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const originalConvexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const originalWebOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN;
const originalEasBuildProfile = process.env.EAS_BUILD_PROFILE;

type AndroidNamedEntry = { $?: Record<string, string> };
type AndroidIntentFilter = {
  action?: AndroidNamedEntry[];
  category?: AndroidNamedEntry[];
  data?: AndroidNamedEntry[];
};
type AndroidActivity = AndroidNamedEntry & {
  "intent-filter"?: AndroidIntentFilter[];
};
type AndroidManifest = {
  manifest?: {
    "uses-permission"?: AndroidNamedEntry[];
    application?: {
      activity?: AndroidActivity[];
      service?: AndroidNamedEntry[];
    }[];
  };
};

const evaluateExpoConfig = async (): Promise<{
  androidManifest?: AndroidManifest;
  ios?: {
    bundleIdentifier?: string;
    entitlements?: Record<string, unknown>;
    infoPlist?: {
      CFBundleURLTypes?: { CFBundleURLSchemes?: string[] }[];
      NSMicrophoneUsageDescription?: string;
      UIBackgroundModes?: string[];
    };
  };
}> => {
  const projectRoot = process.cwd();
  // Expo prebuild applies this public scheme plugin by default. Evaluate it
  // against a deliberately absent native root so local generated projects can
  // never make this test pass when a clean CI checkout would fail.
  const introspectionProjectRoot = `${projectRoot}/.expo-config-introspection-without-native-projects`;
  process.env.APP_VARIANT = "e2e";
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = TEST_CLERK_KEY;
  delete process.env.EXPO_PUBLIC_CONVEX_URL;
  delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  delete process.env.EAS_BUILD_PROFILE;

  const config = getConfig(projectRoot, {
    isModdedConfig: true,
    skipSDKVersionRequirement: true,
  });
  const evaluatedConfig = (await compileModsAsync(
    AndroidConfig.Permissions.withInternalBlockedPermissions(
      IOSConfig.Scheme.withScheme(config.exp),
    ),
    {
      projectRoot: introspectionProjectRoot,
      introspect: true,
      platforms: ["ios", "android"],
      assertMissingModProviders: false,
      ignoreExistingNativeFiles: true,
    },
  )) as typeof config.exp & {
    _internal?: {
      modResults?: { android?: { manifest?: AndroidManifest } };
    };
  };

  return {
    androidManifest: evaluatedConfig._internal?.modResults?.android?.manifest,
    ios: evaluatedConfig.ios,
  };
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = TEST_CLERK_KEY;
  delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  delete process.env.EAS_BUILD_PROFILE;
});

afterEach(() => {
  if (originalAppVariant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = originalAppVariant;
  }
  if (originalConvexUrl === undefined) {
    delete process.env.EXPO_PUBLIC_CONVEX_URL;
  } else {
    process.env.EXPO_PUBLIC_CONVEX_URL = originalConvexUrl;
  }
  if (originalClerkPublishableKey === undefined) {
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  } else {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = originalClerkPublishableKey;
  }
  if (originalWebOrigin === undefined) {
    delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  } else {
    process.env.EXPO_PUBLIC_WEB_ORIGIN = originalWebOrigin;
  }
  if (originalEasBuildProfile === undefined) {
    delete process.env.EAS_BUILD_PROFILE;
  } else {
    process.env.EAS_BUILD_PROFILE = originalEasBuildProfile;
  }
});

describe("native application variants", () => {
  it("defaults local tooling to the development identity", () => {
    expect(resolveAppVariant(undefined)).toBe("development");
    expect(getAppIdentity("development")).toEqual({
      displayName: "Curio Garden (Dev)",
      identifier: "org.curiogarden.app.dev",
      scheme: "curiogarden-dev",
    });
  });

  it("keeps preview and production installable side by side", () => {
    expect(getAppIdentity("preview").identifier).toBe(
      "org.curiogarden.app.preview",
    );
    expect(getAppIdentity("production")).toEqual({
      displayName: "Curio Garden",
      identifier: "org.curiogarden.app",
      scheme: "curiogarden",
    });
  });

  it("keeps automated test builds isolated from preview", () => {
    expect(easConfig.build["e2e-test"].env.APP_VARIANT).toBe("e2e");
    expect(getAppIdentity("e2e")).toEqual({
      displayName: "Curio Garden (E2E)",
      identifier: "org.curiogarden.app.e2e",
      scheme: "curiogarden-e2e",
    });

    process.env.APP_VARIANT = "e2e";
    const config = createAppConfig(configContext);

    expect(config.ios?.bundleIdentifier).toBe("org.curiogarden.app.e2e");
    expect(config.android?.package).toBe("org.curiogarden.app.e2e");
    expect(config.scheme).toBe("curiogarden-e2e");
    expect(config.extra).toMatchObject({
      appVariant: "e2e",
      clerkPublishableKey: TEST_CLERK_KEY,
      webOrigin: "http://127.0.0.1:3000",
    });
  });

  it("maps profiles to reviewed EAS environments without source-controlled keys", () => {
    expect(easConfig.build.development.environment).toBe("development");
    expect(easConfig.build.preview.environment).toBe("preview");
    expect(easConfig.build["e2e-test"].environment).toBe("development");
    expect(easConfig.build.production.environment).toBe("production");

    for (const profile of Object.values(easConfig.build)) {
      expect(profile.env).not.toHaveProperty(
        "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
      );
      expect(profile.env).not.toHaveProperty("EXPO_PUBLIC_WEB_ORIGIN");
    }
  });

  it("fails closed when a build profile supplies an unknown variant", () => {
    expect(() => resolveAppVariant("staging")).toThrow(
      'Unsupported APP_VARIANT "staging"',
    );
  });

  it("produces a native-only production config without notification setup", () => {
    process.env.APP_VARIANT = "production";
    process.env.EAS_BUILD_PROFILE = "production";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = LIVE_CLERK_KEY;
    process.env.EXPO_PUBLIC_CONVEX_URL =
      "https://production-garden.convex.cloud";

    const config = createAppConfig(configContext);

    expect(config.platforms).toEqual(["ios", "android"]);
    expect(config.orientation).toBe("default");
    expect(config.primaryColor).toBe("#036b4a");
    expect(config.ios?.bundleIdentifier).toBe("org.curiogarden.app");
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
    expect(config.ios?.buildNumber).toBeUndefined();
    expect(config.android?.package).toBe("org.curiogarden.app");
    expect(config.android?.versionCode).toBeUndefined();
    expect(config.android?.blockedPermissions).toEqual([
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.RECORD_AUDIO",
      "android.permission.REORDER_TASKS",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ]);
    const pluginIdentifiers = (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );

    // Keep plugin declarations statically auditable instead of allowing a
    // function-valued entry to disappear from serialized config checks.
    expect(
      pluginIdentifiers.every((identifier) => typeof identifier === "string"),
    ).toBe(true);
    expect(config.plugins).toContainEqual([
      "@clerk/expo",
      { appleSignIn: false },
    ]);
    expect(config.plugins).toContainEqual([
      "expo-audio",
      {
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ]);
    expect(pluginIdentifiers).toContain("expo-secure-store");
    expect(pluginIdentifiers).not.toContain("expo-notifications");
    expect(pluginIdentifiers).not.toContain("expo-file-system");
    expect(pluginIdentifiers).not.toContain("expo-apple-authentication");
    expect(pluginIdentifiers).not.toContain("expo-auth-session");
    expect(pluginIdentifiers).toContain("expo-web-browser");
    expect(config.extra).toMatchObject({
      appVariant: "production",
      clerkPublishableKey: LIVE_CLERK_KEY,
      convexUrl: "https://production-garden.convex.cloud",
      webOrigin: "https://curiogarden.org",
      eas: { projectId: "85f56112-e78d-49c6-9b4c-e5872096a1ea" },
    });
  });

  it("keeps summary audio foreground-only without recording access", async () => {
    const evaluatedConfig = await evaluateExpoConfig();
    const androidPermissionEntries =
      evaluatedConfig.androidManifest?.manifest?.["uses-permission"] ?? [];
    const isRemovalMarker = (entry: AndroidNamedEntry) => {
      const operation = entry.$?.["tools:node"];
      return operation === "remove" || operation === "removeAll";
    };
    const androidPermissionNames = androidPermissionEntries
      .filter((permission) => !isRemovalMarker(permission))
      .flatMap((permission) => permission.$?.["android:name"] ?? []);
    const removedAndroidPermissionNames = androidPermissionEntries
      .filter(isRemovalMarker)
      .flatMap((permission) => permission.$?.["android:name"] ?? []);
    const androidServiceNames =
      evaluatedConfig.androidManifest?.manifest?.application?.[0]?.service?.flatMap(
        (service) =>
          isRemovalMarker(service) ? [] : (service.$?.["android:name"] ?? []),
      ) ?? [];

    expect(evaluatedConfig.ios?.infoPlist).not.toHaveProperty(
      "NSMicrophoneUsageDescription",
    );
    expect(
      evaluatedConfig.ios?.infoPlist?.UIBackgroundModes ?? [],
    ).not.toContain("audio");
    expect(androidPermissionNames).toContain(
      "android.permission.MODIFY_AUDIO_SETTINGS",
    );
    expect(removedAndroidPermissionNames).toContain(
      "android.permission.RECORD_AUDIO",
    );
    for (const forbiddenPermission of [
      "android.permission.RECORD_AUDIO",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS",
    ]) {
      expect(androidPermissionNames).not.toContain(forbiddenPermission);
    }
    for (const forbiddenService of [
      "expo.modules.audio.service.AudioControlsService",
      "expo.modules.audio.service.AudioRecordingService",
    ]) {
      expect(androidServiceNames).not.toContain(forbiddenService);
    }
  });

  it.each([
    ["development", undefined],
    ["preview", "https://preview-garden.convex.cloud"],
    ["e2e", undefined],
  ] as const)(
    "requires a reviewed HTTPS web origin for cloud %s builds",
    (variant, convexUrl) => {
      process.env.APP_VARIANT = variant;
      process.env.EAS_BUILD_PROFILE = `${variant}-cloud`;
      if (convexUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CONVEX_URL;
      } else {
        process.env.EXPO_PUBLIC_CONVEX_URL = convexUrl;
      }
      delete process.env.EXPO_PUBLIC_WEB_ORIGIN;

      expect(() => createAppConfig(configContext)).toThrow(
        "Cloud non-production builds require an explicit HTTPS web origin",
      );

      process.env.EXPO_PUBLIC_WEB_ORIGIN = "http://10.0.2.2:3000";
      expect(() => createAppConfig(configContext)).toThrow(
        "Cloud non-production builds require an explicit HTTPS web origin",
      );

      process.env.EXPO_PUBLIC_WEB_ORIGIN = PR_PREVIEW_WEB_ORIGIN;
      expect(createAppConfig(configContext).extra).toMatchObject({
        appVariant: variant,
        webOrigin: PR_PREVIEW_WEB_ORIGIN,
      });
    },
  );

  it("fails closed before preview or production can cross environments", () => {
    process.env.APP_VARIANT = "production";
    delete process.env.EXPO_PUBLIC_CONVEX_URL;

    expect(() => createAppConfig(configContext)).toThrow(
      "EXPO_PUBLIC_CONVEX_URL is required for production builds",
    );

    process.env.APP_VARIANT = "preview";
    process.env.EXPO_PUBLIC_CONVEX_URL =
      "https://standing-finch-735.convex.cloud";
    expect(() => createAppConfig(configContext)).toThrow(
      "preview builds must not use the development deployment",
    );
  });

  it("fails closed before builds can cross Clerk environments", () => {
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    expect(() => createAppConfig(configContext)).toThrow(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required for development builds",
    );

    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_not-a-key";
    expect(() => createAppConfig(configContext)).toThrow(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must be a valid Clerk publishable key",
    );

    process.env.APP_VARIANT = "preview";
    process.env.EXPO_PUBLIC_CONVEX_URL = "https://preview-garden.convex.cloud";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = LIVE_CLERK_KEY;
    expect(() => createAppConfig(configContext)).toThrow(
      "preview builds must use a Clerk test publishable key",
    );

    process.env.APP_VARIANT = "production";
    process.env.EXPO_PUBLIC_CONVEX_URL =
      "https://production-garden.convex.cloud";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = TEST_CLERK_KEY;
    expect(() => createAppConfig(configContext)).toThrow(
      "production builds must use a Clerk live publishable key",
    );
  });

  it("embeds every supported Curio Garden typeface in signed builds", () => {
    const config = createAppConfig(configContext);
    const fontPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-font",
    );

    expect(bundledFontFiles).toEqual([
      "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
      "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
      "@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf",
      "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
      "@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf",
      "@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf",
      "@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf",
      "@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf",
    ]);
    expect(fontPlugin).toEqual(["expo-font", { fonts: bundledFontFiles }]);
    const resolveModule = (
      require as unknown as { resolve(moduleId: string): string }
    ).resolve;
    for (const fontFile of bundledFontFiles) {
      expect(() => resolveModule(fontFile)).not.toThrow();
    }
  });

  it("uses the native Clerk SDK's explicit iOS deployment floor", () => {
    const config = createAppConfig(configContext);
    const buildPropertiesPlugin = config.plugins?.find(
      (plugin) =>
        Array.isArray(plugin) && plugin[0] === "expo-build-properties",
    );

    expect(buildPropertiesPlugin).toMatchObject([
      "expo-build-properties",
      { ios: { deploymentTarget: "17.0" } },
    ]);
  });

  it("keeps Apple Sign In disabled until its signed-build product gate passes", async () => {
    const evaluatedConfig = await evaluateExpoConfig();

    expect(evaluatedConfig.ios?.bundleIdentifier).toBe(
      "org.curiogarden.app.e2e",
    );
    expect(evaluatedConfig.ios?.entitlements).not.toHaveProperty([
      "com.apple.developer.applesignin",
    ]);

    const iosCallbackSchemes =
      evaluatedConfig.ios?.infoPlist?.CFBundleURLTypes?.flatMap(
        (entry) => entry.CFBundleURLSchemes ?? [],
      );
    expect(iosCallbackSchemes).toContain("org.curiogarden.app.e2e");

    const mainActivity =
      evaluatedConfig.androidManifest?.manifest?.application?.[0]?.activity?.find(
        (activity) => activity.$?.["android:name"] === ".MainActivity",
      );
    const hostedCallback = mainActivity?.["intent-filter"]?.find((filter) =>
      filter.data?.some(
        (entry) =>
          entry.$?.["android:scheme"] === "clerk" &&
          entry.$?.["android:host"] ===
            "org.curiogarden.app.e2e.hosted-callback",
      ),
    );
    expect(hostedCallback?.action).toContainEqual({
      $: { "android:name": "android.intent.action.VIEW" },
    });
    expect(hostedCallback?.category).toEqual(
      expect.arrayContaining([
        { $: { "android:name": "android.intent.category.DEFAULT" } },
        { $: { "android:name": "android.intent.category.BROWSABLE" } },
      ]),
    );
  });
});
