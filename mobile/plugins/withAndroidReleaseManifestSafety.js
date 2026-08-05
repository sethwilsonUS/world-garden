const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const CLERK_RELEASE_ONLY_ACTIVITY_NAMES = Object.freeze([
  "androidx.compose.ui.tooling.PreviewActivity",
  "androidx.test.core.app.InstrumentationActivityInvoker$BootstrapActivity",
  "androidx.test.core.app.InstrumentationActivityInvoker$EmptyActivity",
  "androidx.test.core.app.InstrumentationActivityInvoker$EmptyFloatingActivity",
]);

const releaseOnlyActivityNames = new Set(CLERK_RELEASE_ONLY_ACTIVITY_NAMES);

const removeClerkToolingFromReleaseManifest = (manifest) => {
  AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const retainedActivities = (application.activity ?? []).filter(
    (activity) => !releaseOnlyActivityNames.has(activity.$["android:name"]),
  );

  application.activity = [
    ...retainedActivities,
    ...CLERK_RELEASE_ONLY_ACTIVITY_NAMES.map((activityName) => ({
      $: {
        "android:name": activityName,
        "tools:node": "remove",
      },
    })),
  ];

  return manifest;
};

const withAndroidReleaseManifestSafety = (config) =>
  withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = removeClerkToolingFromReleaseManifest(
      modConfig.modResults,
    );
    return modConfig;
  });

module.exports = withAndroidReleaseManifestSafety;
module.exports.default = withAndroidReleaseManifestSafety;
module.exports.CLERK_RELEASE_ONLY_ACTIVITY_NAMES =
  CLERK_RELEASE_ONLY_ACTIVITY_NAMES;
module.exports.removeClerkToolingFromReleaseManifest =
  removeClerkToolingFromReleaseManifest;
