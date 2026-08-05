import {
  getMobileRuntimeConfig,
  parseMobileRuntimeConfig,
} from "./runtime-config";

const TEST_CLERK_KEY = "pk_test_Y2kuY3VyaW9nYXJkZW4uaW52YWxpZCQ";
const LIVE_CLERK_KEY = "pk_live_cHJvZHVjdGlvbi5jdXJpb2dhcmRlbi5pbnZhbGlkJA";
const PR_PREVIEW_WEB_ORIGIN =
  "https://world-garden-git-media-sethwilsonus-projects.vercel.app";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appVariant: "e2e",
        clerkPublishableKey: TEST_CLERK_KEY,
        convexUrl: "https://standing-finch-735.convex.cloud",
        webOrigin: "http://127.0.0.1:3000",
      },
    },
  },
}));

describe("mobile runtime configuration", () => {
  it("reads the build-time reviewed Expo extra values", () => {
    expect(getMobileRuntimeConfig()).toEqual({
      appVariant: "e2e",
      clerkPublishableKey: TEST_CLERK_KEY,
      convexUrl: "https://standing-finch-735.convex.cloud",
      webOrigin: "http://127.0.0.1:3000",
    });
  });

  it("fails closed when build metadata is missing", () => {
    expect(() => parseMobileRuntimeConfig(undefined)).toThrow(
      "Native runtime configuration is missing",
    );
    expect(() => parseMobileRuntimeConfig({ appVariant: "e2e" })).toThrow(
      "Native Convex deployment configuration is missing",
    );
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "e2e",
        convexUrl: "https://standing-finch-735.convex.cloud",
      }),
    ).toThrow("Native Clerk publishable key configuration is missing");
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "e2e",
        clerkPublishableKey: TEST_CLERK_KEY,
        convexUrl: "https://standing-finch-735.convex.cloud",
      }),
    ).toThrow("Native web origin configuration is missing");
  });

  it("revalidates the deployment against the embedded variant", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "production",
        clerkPublishableKey: LIVE_CLERK_KEY,
        convexUrl: "https://standing-finch-735.convex.cloud",
        webOrigin: "https://curiogarden.org",
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

  it("revalidates the Clerk instance against the embedded variant", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "production",
        clerkPublishableKey: TEST_CLERK_KEY,
        convexUrl: "https://production-garden.convex.cloud",
        webOrigin: "https://curiogarden.org",
      }),
    ).toThrow("production builds must use a Clerk live publishable key");
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "e2e",
        clerkPublishableKey: LIVE_CLERK_KEY,
        convexUrl: "https://standing-finch-735.convex.cloud",
        webOrigin: "http://127.0.0.1:3000",
      }),
    ).toThrow("e2e builds must use a Clerk test publishable key");
  });

  it("rejects malformed embedded Clerk metadata", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "e2e",
        clerkPublishableKey: "pk_test_not-a-key",
        convexUrl: "https://standing-finch-735.convex.cloud",
        webOrigin: "http://127.0.0.1:3000",
      }),
    ).toThrow("must be a valid Clerk publishable key");
  });

  it("revalidates the embedded web origin against the application variant", () => {
    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "production",
        clerkPublishableKey: LIVE_CLERK_KEY,
        convexUrl: "https://production-garden.convex.cloud",
        webOrigin: PR_PREVIEW_WEB_ORIGIN,
      }),
    ).toThrow("production builds must use https://curiogarden.org");

    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "preview",
        clerkPublishableKey: TEST_CLERK_KEY,
        convexUrl: "https://preview-garden.convex.cloud",
        webOrigin: "https://curiogarden.org",
      }),
    ).toThrow("preview builds must not use the production web origin");

    expect(() =>
      parseMobileRuntimeConfig({
        appVariant: "preview",
        clerkPublishableKey: TEST_CLERK_KEY,
        convexUrl: "https://preview-garden.convex.cloud",
        webOrigin: "https://attacker.example.com",
      }),
    ).toThrow("must name an approved Curio Garden PR preview host");
  });
});
