import {
  applyReactNativeSpmUuidSafety,
  SPM_UUID_SAFETY_MARKER,
} from "../../plugins/withReactNativeSpmUuidSafety";

const template = `require "react_native_pods"

prepare_react_native_project!

target 'CurioGardenE2E' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
    )
  end
end
`;

describe("the React Native Swift-package UUID backport", () => {
  it("scopes collision-safe UUID generation to the generated Pods project", () => {
    const result = applyReactNativeSpmUuidSafety(template);

    expect(result).toContain(SPM_UUID_SAFETY_MARKER);
    expect(result).toContain("module CurioGardenCollisionSafeSpmUuids");
    expect(result).toContain("uuid = super while objects_by_uuid.key?(uuid)");
    expect(result).toContain(
      "installer.pods_project.singleton_class.prepend(CurioGardenCollisionSafeSpmUuids)",
    );
    expect(result.indexOf("singleton_class.prepend")).toBeLessThan(
      result.indexOf("react_native_post_install("),
    );
  });

  it("is idempotent across repeated clean-prebuild mod evaluation", () => {
    const once = applyReactNativeSpmUuidSafety(template);

    expect(applyReactNativeSpmUuidSafety(once)).toBe(once);
    expect(once.match(new RegExp(SPM_UUID_SAFETY_MARKER, "g"))).toHaveLength(1);
  });

  it("fails closed when the Expo Podfile template changes", () => {
    expect(() =>
      applyReactNativeSpmUuidSafety("target 'Other' do\nend\n"),
    ).toThrow(/Podfile template/);
  });
});
