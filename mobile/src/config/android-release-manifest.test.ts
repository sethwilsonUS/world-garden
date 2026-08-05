import type { AndroidManifest } from "@expo/config-plugins";

import {
  CLERK_RELEASE_ONLY_ACTIVITY_NAMES,
  removeClerkToolingFromReleaseManifest,
} from "../../plugins/withAndroidReleaseManifestSafety";

const createManifest = (): AndroidManifest => ({
  manifest: {
    $: {
      "xmlns:android": "http://schemas.android.com/apk/res/android",
    },
    application: [
      {
        $: { "android:name": ".MainApplication" },
        activity: [
          {
            $: {
              "android:exported": "true",
              "android:name": ".MainActivity",
            },
          },
        ],
      },
    ],
    queries: [],
  },
});

describe("Android release-manifest hardening", () => {
  it("adds merge tombstones for Clerk's exported test and preview activities", () => {
    const manifest = removeClerkToolingFromReleaseManifest(createManifest());
    const application = manifest.manifest.application?.[0];

    expect(manifest.manifest.$["xmlns:tools"]).toBe(
      "http://schemas.android.com/tools",
    );
    expect(application?.activity).toContainEqual({
      $: {
        "android:exported": "true",
        "android:name": ".MainActivity",
      },
    });
    for (const activityName of CLERK_RELEASE_ONLY_ACTIVITY_NAMES) {
      expect(application?.activity).toContainEqual({
        $: {
          "android:name": activityName,
          "tools:node": "remove",
        },
      });
    }
  });

  it("is idempotent and replaces any inherited local declarations", () => {
    const manifest = createManifest();
    const inheritedActivity = CLERK_RELEASE_ONLY_ACTIVITY_NAMES[0];
    if (inheritedActivity === undefined) {
      throw new Error("Expected a Clerk release-only activity fixture");
    }
    manifest.manifest.application?.[0]?.activity?.push({
      $: {
        "android:exported": "true",
        "android:name": inheritedActivity,
      },
    });

    removeClerkToolingFromReleaseManifest(manifest);
    removeClerkToolingFromReleaseManifest(manifest);

    for (const activityName of CLERK_RELEASE_ONLY_ACTIVITY_NAMES) {
      expect(
        manifest.manifest.application?.[0]?.activity?.filter(
          (activity) => activity.$["android:name"] === activityName,
        ),
      ).toEqual([
        {
          $: {
            "android:name": activityName,
            "tools:node": "remove",
          },
        },
      ]);
    }
  });
});
