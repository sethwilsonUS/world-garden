import type { ConfigContext } from "expo/config";

import createAppConfig, {
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
    expect(JSON.stringify(config.plugins)).not.toContain("expo-notifications");
    expect(config.extra).toMatchObject({
      appVariant: "production",
      eas: { projectId: "85f56112-e78d-49c6-9b4c-e5872096a1ea" },
    });
  });
});
