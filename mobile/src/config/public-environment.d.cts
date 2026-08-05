export type ConvexEnvironmentVariant =
  | "development"
  | "preview"
  | "e2e"
  | "production";

export const DEVELOPMENT_CONVEX_URL: string;

export function resolveConvexDeploymentUrl(
  variant: ConvexEnvironmentVariant,
  configuredValue: string | undefined,
): string;

export function resolveClerkPublishableKey(
  variant: ConvexEnvironmentVariant,
  configuredValue: string | undefined,
): string;
