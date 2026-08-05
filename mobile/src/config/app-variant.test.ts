import type { ConfigContext } from "expo/config";

import createAppConfig, {
  bundledFontFiles,
  getAppIdentity,
  resolveAppVariant,
} from "../../app.config";
import easConfig from "../../eas.json";

const configContext = { config: {} } as ConfigContext;
const originalAppVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (originalAppVariant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = originalAppVariant;
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
  });

  it("fails closed when a build profile supplies an unknown variant", () => {
    expect(() => resolveAppVariant("staging")).toThrow(
      'Unsupported APP_VARIANT "staging"',
    );
  });

  it("produces a native-only production config without notification setup", () => {
    process.env.APP_VARIANT = "production";

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
    expect(pluginIdentifiers).not.toContain("expo-notifications");
    expect(pluginIdentifiers).not.toContain("expo-file-system");
    expect(config.extra).toMatchObject({
      appVariant: "production",
      eas: { projectId: "85f56112-e78d-49c6-9b4c-e5872096a1ea" },
    });
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
});
