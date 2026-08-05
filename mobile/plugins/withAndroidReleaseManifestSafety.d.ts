import type { AndroidManifest, ConfigPlugin } from "expo/config-plugins";

export declare const CLERK_RELEASE_ONLY_ACTIVITY_NAMES: readonly string[];
export declare const removeClerkToolingFromReleaseManifest: (
  manifest: AndroidManifest,
) => AndroidManifest;

declare const withAndroidReleaseManifestSafety: ConfigPlugin;
export default withAndroidReleaseManifestSafety;
