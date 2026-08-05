const { withPodfile } = require("expo/config-plugins");

const SPM_UUID_SAFETY_MARKER = "CurioGardenReactNativeSpmUuidSafetyBackport";

const rubyModule = `
# ${SPM_UUID_SAFETY_MARKER}
# Backport of React Native 1cdf784 (first released in 0.87.0-rc.2).
# Remove this shim after Expo supports React Native 0.87 or newer.
module CurioGardenCollisionSafeSpmUuids
  def generate_uuid
    uuid = super
    uuid = super while objects_by_uuid.key?(uuid)
    uuid
  end
end
`;

const prepareAnchor = "prepare_react_native_project!\n";
const postInstallAnchor = "    react_native_post_install(\n";

const count = (source, value) => source.split(value).length - 1;

const applyReactNativeSpmUuidSafety = (podfile) => {
  if (podfile.includes(SPM_UUID_SAFETY_MARKER)) {
    if (
      !podfile.includes("module CurioGardenCollisionSafeSpmUuids") ||
      !podfile.includes(
        "installer.pods_project.singleton_class.prepend(CurioGardenCollisionSafeSpmUuids)",
      )
    ) {
      throw new Error(
        "The React Native SPM UUID Podfile backport is incomplete.",
      );
    }

    return podfile;
  }

  if (
    count(podfile, prepareAnchor) !== 1 ||
    count(podfile, postInstallAnchor) !== 1
  ) {
    throw new Error(
      "The Expo Podfile template changed; review the React Native SPM UUID backport before building iOS.",
    );
  }

  return podfile
    .replace(prepareAnchor, `${prepareAnchor}${rubyModule}\n`)
    .replace(
      postInstallAnchor,
      `    installer.pods_project.singleton_class.prepend(CurioGardenCollisionSafeSpmUuids)\n${postInstallAnchor}`,
    );
};

const withReactNativeSpmUuidSafety = (config) =>
  withPodfile(config, (modConfig) => {
    modConfig.modResults.contents = applyReactNativeSpmUuidSafety(
      modConfig.modResults.contents,
    );
    return modConfig;
  });

module.exports = withReactNativeSpmUuidSafety;
module.exports.default = withReactNativeSpmUuidSafety;
module.exports.applyReactNativeSpmUuidSafety = applyReactNativeSpmUuidSafety;
module.exports.SPM_UUID_SAFETY_MARKER = SPM_UUID_SAFETY_MARKER;
