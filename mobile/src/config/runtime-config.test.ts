import {
  getMobileRuntimeConfig,
  parseMobileRuntimeConfig,
} from "./runtime-config";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appVariant: "e2e",
        convexUrl: "https://standing-finch-735.convex.cloud",
      },
    },
  },
}));

describe("mobile runtime configuration", () => {
  it("reads the build-time reviewed Expo extra values", () => {
    expect(getMobileRuntimeConfig()).toEqual({
      appVariant: "e2e",
      convexUrl: "https://standing-finch-735.convex.cloud",
    });
  });

  it("fails closed when build metadata is missing", () => {
    expect(() => parseMobileRuntimeConfig(undefined)).toThrow(
      "Native runtime configuration is missing",
    );
    expect(() => parseMobileRuntimeConfig({ appVariant: "e2e" })).toThrow(
      "Native Convex deployment configuration is missing",
    );
  });

  it("revalidates the deployment against the embedded variant", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "production",
        convexUrl: "https://standing-finch-735.convex.cloud",
      }),
    ).toThrow("production builds must not use the development deployment");
  });

  it("rejects unknown variants rather than guessing an environment", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "staging",
        convexUrl: "https://staging-garden.convex.cloud",
      }),
    ).toThrow("Native application variant is invalid");
  });
});
