import Constants from "expo-constants";

import {
  resolveClerkPublishableKey,
  resolveConvexDeploymentUrl,
  resolvePublicWebOrigin,
  type ConvexEnvironmentVariant,
} from "./public-environment.cjs";

export type MobileRuntimeConfig = Readonly<{
  appVariant: ConvexEnvironmentVariant;
  clerkPublishableKey: string;
  convexUrl: string;
  webOrigin: string;
}>;

const variants = new Set<string>([
  "development",
  "preview",
  "e2e",
  "production",
]);

const isConvexEnvironmentVariant = (
  value: unknown,
): value is ConvexEnvironmentVariant =>
  typeof value === "string" && variants.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function parseMobileRuntimeConfig(extra: unknown): MobileRuntimeConfig {
  if (!isRecord(extra)) {
    throw new Error("Native runtime configuration is missing");
  }

  const appVariant = extra.appVariant;
  if (!isConvexEnvironmentVariant(appVariant)) {
    throw new Error("Native application variant is invalid");
  }
  if (typeof extra.convexUrl !== "string" || !extra.convexUrl.trim()) {
    throw new Error("Native Convex deployment configuration is missing");
  }
  if (
    typeof extra.clerkPublishableKey !== "string" ||
    !extra.clerkPublishableKey.trim()
  ) {
    throw new Error("Native Clerk publishable key configuration is missing");
  }
  if (typeof extra.webOrigin !== "string" || !extra.webOrigin.trim()) {
    throw new Error("Native web origin configuration is missing");
  }

  return {
    appVariant,
    clerkPublishableKey: resolveClerkPublishableKey(
      appVariant,
      extra.clerkPublishableKey,
    ),
    convexUrl: resolveConvexDeploymentUrl(appVariant, extra.convexUrl),
    webOrigin: resolvePublicWebOrigin(appVariant, extra.webOrigin),
  };
}

export const getMobileRuntimeConfig = (): MobileRuntimeConfig =>
  parseMobileRuntimeConfig(Constants.expoConfig?.extra);
