export type ConvexEnvironmentVariant =
  | "development"
  | "preview"
  | "e2e"
  | "production";

export const DEVELOPMENT_CONVEX_URL: string;
export const DEVELOPMENT_WEB_ORIGIN: string;
export const PRODUCTION_WEB_ORIGIN: string;

export function resolveConvexDeploymentUrl(
  variant: ConvexEnvironmentVariant,
  configuredValue: string | undefined,
): string;

export function resolveClerkPublishableKey(
  variant: ConvexEnvironmentVariant,
  configuredValue: string | undefined,
): string;

export function resolvePublicWebOrigin(
  variant: ConvexEnvironmentVariant,
  configuredValue: string | undefined,
  options?: Readonly<{ requireExplicitHttps?: boolean }>,
): string;
