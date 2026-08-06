/// <reference types="node" />

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyExpoAudioBackgroundSafety,
  EXPO_AUDIO_BACKGROUND_SAFETY_MARKER,
  EXPO_AUDIO_VERSION,
  patchInstalledExpoAudio,
  type ExpoAudioBackgroundSafetySources,
} from "../../scripts/expo-audio-background-safety";

const expoAudioRoot = path.dirname(require.resolve("expo-audio/package.json"));

const sourcePaths = {
  androidBaseAudioPlayer: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt",
  ),
  androidAudioModule: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/AudioModule.kt",
  ),
  androidAudioPlayer: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/AudioPlayer.kt",
  ),
  androidControlsService: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/service/AudioControlsService.kt",
  ),
  iosMediaController: path.join(expoAudioRoot, "ios/MediaController.swift"),
} as const;

const readInstalledSources = (): ExpoAudioBackgroundSafetySources => ({
  androidBaseAudioPlayer: fs.readFileSync(
    sourcePaths.androidBaseAudioPlayer,
    "utf8",
  ),
  androidAudioModule: fs.readFileSync(sourcePaths.androidAudioModule, "utf8"),
  androidAudioPlayer: fs.readFileSync(sourcePaths.androidAudioPlayer, "utf8"),
  androidControlsService: fs.readFileSync(
    sourcePaths.androidControlsService,
    "utf8",
  ),
  iosMediaController: fs.readFileSync(sourcePaths.iosMediaController, "utf8"),
});

const fixtureRoots: string[] = [];

const createInstalledFixture = (
  sources: ExpoAudioBackgroundSafetySources,
  version = "57.0.3",
): string => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "curio-expo-audio-safety-"),
  );
  fixtureRoots.push(projectRoot);
  const packageRoot = path.join(projectRoot, "node_modules/expo-audio");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "expo-audio", version }),
  );

  for (const [key, installedPath] of Object.entries(sourcePaths)) {
    const fixturePath = path.join(
      packageRoot,
      path.relative(expoAudioRoot, installedPath),
    );
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(
      fixturePath,
      sources[key as keyof ExpoAudioBackgroundSafetySources],
    );
  }
  return projectRoot;
};

const readFixtureSources = (
  projectRoot: string,
): ExpoAudioBackgroundSafetySources => {
  const packageRoot = path.join(projectRoot, "node_modules/expo-audio");
  return Object.fromEntries(
    Object.entries(sourcePaths).map(([key, installedPath]) => [
      key,
      fs.readFileSync(
        path.join(packageRoot, path.relative(expoAudioRoot, installedPath)),
        "utf8",
      ),
    ]),
  ) as ExpoAudioBackgroundSafetySources;
};

afterEach(() => {
  while (fixtureRoots.length > 0) {
    const fixtureRoot = fixtureRoots.pop();
    if (fixtureRoot !== undefined) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

describe("the pinned Expo Audio background-playback safety backport", () => {
  it("reports the exact installed Expo Audio version from one source of truth", () => {
    expect(EXPO_AUDIO_VERSION).toBe(require("expo-audio/package.json").version);
  });

  it("builds the patched module from source without touching web install hooks", () => {
    const mobilePackage = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    const rootPackage = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
    );

    expect(mobilePackage.expo.autolinking.android.buildFromSource).toEqual([
      "expo-audio",
    ]);
    expect(mobilePackage.expo.autolinking.ios.buildFromSource).toEqual([
      "expo-audio",
    ]);
    expect(mobilePackage.scripts["eas-build-post-install"]).toBe(
      "npm run native:patch:apply",
    );
    expect(mobilePackage.scripts.preios).toBe("npm run native:patch:apply");
    expect(mobilePackage.scripts.preandroid).toBe("npm run native:patch:apply");
    expect(mobilePackage.scripts.postinstall).toBeUndefined();
    expect(rootPackage.scripts.postinstall).toBeUndefined();
  });

  it("keeps one Android audio-focus owner across UI and system play requests", () => {
    const result = applyExpoAudioBackgroundSafety(readInstalledSources());

    expect(result.androidAudioModule).toContain(
      EXPO_AUDIO_BACKGROUND_SAFETY_MARKER,
    );
    expect(result.androidAudioModule).toContain(
      "private fun playWithAudioFocus(playable: BaseAudioPlayer)",
    );
    expect(result.androidAudioModule).toContain(
      "AudioFocusRequestResult.DELAYED ->",
    );
    expect(result.androidAudioModule).toContain("focusRequestPending = true");
    expect(result.androidAudioModule).toContain(
      "if (focusRequestPending) {\n      return AudioFocusRequestResult.DELAYED",
    );
    expect(result.androidAudioModule).toContain(
      "playable.waitingForAudioFocus = true",
    );
    expect(result.androidAudioModule).toContain(
      "private fun cancelPlayback(playable: BaseAudioPlayer)",
    );
    expect(result.androidAudioModule).toContain(
      "playable.isPaused = false\n    playable.pause()",
    );
    expect(result.androidAudioModule).toContain(
      "if (shouldReleaseFocus()) {\n      releaseAudioFocus()",
    );
    expect(result.androidAudioModule).toContain(
      "if (shouldReleaseFocus()) {\n            releaseAudioFocus()",
    );
    expect(result.androidAudioModule).toContain(
      "allPlayables.filter { it.waitingForAudioFocus }.toList()",
    );
    expect(result.androidAudioModule).toContain(
      "player.onPlaybackRequested = { playWithAudioFocus(player) }",
    );
    expect(result.androidAudioModule).toContain(
      'Function("play") { player: AudioPlayer ->\n        runOnMain {\n          playWithAudioFocus(player)',
    );
    expect(result.androidAudioModule).toContain(
      'Function("play") { playlist: AudioPlaylist ->\n        runOnMain {\n          playWithAudioFocus(playlist)',
    );
    expect(result.androidAudioModule).toContain(
      'Function("pause") { player: AudioPlayer ->\n        runOnMain {\n          cancelPlayback(player)',
    );
    expect(result.androidAudioModule).toContain(
      'Function("pause") { playlist: AudioPlaylist ->\n        runOnMain {\n          cancelPlayback(playlist)',
    );
    expect(result.androidBaseAudioPlayer).toContain(
      "internal var waitingForAudioFocus = false",
    );
    expect(result.androidBaseAudioPlayer).toContain(
      "internal fun reportPlaybackNotStarted()",
    );
    expect(result.androidAudioPlayer).toContain(
      "internal var onPlaybackRequested: (() -> Unit)? = null",
    );
    expect(result.androidAudioPlayer).toContain(
      "internal var onPlaybackCancelled: (() -> Unit)? = null",
    );
    expect(result.androidAudioPlayer).toContain(
      "internal fun requestPlaybackFromSystemControls()",
    );
    expect(result.androidAudioPlayer).toContain(
      "onPlaybackRequested?.invoke()",
    );
    expect(result.androidAudioPlayer).toContain("onPlaybackRequested = null");
    expect(result.androidAudioPlayer).toContain(
      "onPlaybackCancelled?.invoke()",
    );
    expect(result.androidAudioPlayer).toContain(
      ".setAudioAttributes(AudioAttributes.DEFAULT, false)",
    );
    expect(result.androidAudioPlayer).not.toContain(
      ".setAudioAttributes(AudioAttributes.DEFAULT, true)",
    );
  });

  it("routes modern and legacy Android system controls through that focus gate", () => {
    const { androidControlsService } = applyExpoAudioBackgroundSafety(
      readInstalledSources(),
    );

    expect(androidControlsService).toContain(
      "activePlayer.requestPlaybackFromSystemControls()",
    );
    expect(androidControlsService).toContain(
      "activePlayer.cancelPlaybackFromSystemControls()",
    );
    expect(androidControlsService).toContain("override fun play() {");
    expect(androidControlsService).toContain(
      "player.requestPlaybackFromSystemControls()",
    );
    expect(androidControlsService).toContain(
      "override fun setPlayWhenReady(playWhenReady: Boolean)",
    );
    expect(androidControlsService).toContain(
      "if (playWhenReady) {\n          player.requestPlaybackFromSystemControls()",
    );
    expect(androidControlsService).toContain(
      "override fun pause() {\n        player.cancelPlaybackFromSystemControls()",
    );
    expect(androidControlsService).not.toMatch(
      /ACTION_PLAY[\s\S]{0,180}currentPlayerRef\.play\(\)/,
    );
  });

  it("removes every opaque iOS remote-command target before replacement", () => {
    const { iosMediaController } = applyExpoAudioBackgroundSafety(
      readInstalledSources(),
    );

    expect(iosMediaController).toContain(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER);
    expect(iosMediaController).toContain(
      "private var remoteCommandTargets: [(command: MPRemoteCommand, target: Any)] = []",
    );
    expect(iosMediaController).toContain("removeRemoteCommandTargets()");
    expect(iosMediaController).toContain("command.removeTarget(target)");
    expect(
      iosMediaController.match(/remoteCommandTargets\.append/g),
    ).toHaveLength(6);
    expect(iosMediaController).not.toContain("removeTarget(self)");
  });

  it("is idempotent after a clean prebuild has already applied it", () => {
    const once = applyExpoAudioBackgroundSafety(readInstalledSources());

    expect(applyExpoAudioBackgroundSafety(once)).toEqual(once);
  });

  it("checks without mutation and atomically replaces each preflighted file", () => {
    const original = readInstalledSources();
    const projectRoot = createInstalledFixture(original);
    const originalState = original.androidAudioModule.includes(
      EXPO_AUDIO_BACKGROUND_SAFETY_MARKER,
    )
      ? "patched"
      : "pristine";

    expect(patchInstalledExpoAudio(projectRoot, "check")).toEqual({
      changed: false,
      state: originalState,
    });
    expect(readFixtureSources(projectRoot)).toEqual(original);

    patchInstalledExpoAudio(projectRoot, "apply");
    expect(readFixtureSources(projectRoot)).toEqual(
      applyExpoAudioBackgroundSafety(original),
    );
    expect(patchInstalledExpoAudio(projectRoot, "apply")).toEqual({
      changed: false,
      state: "patched",
    });
  });

  it("does not write any target when version or source preflight fails", () => {
    const original = readInstalledSources();
    const wrongVersionRoot = createInstalledFixture(original, "57.0.4");
    expect(() => patchInstalledExpoAudio(wrongVersionRoot, "apply")).toThrow(
      /Expected expo-audio 57\.0\.3/,
    );
    expect(readFixtureSources(wrongVersionRoot)).toEqual(original);

    const changedSources = {
      ...original,
      iosMediaController: `${original.iosMediaController}\n// unexpected`,
    };
    const changedSourceRoot = createInstalledFixture(changedSources);
    expect(() => patchInstalledExpoAudio(changedSourceRoot, "apply")).toThrow(
      /does not match a reviewed pristine or patched source hash/,
    );
    expect(readFixtureSources(changedSourceRoot)).toEqual(changedSources);
  });

  it("fails closed when the pinned native source contract changes", () => {
    const sources = readInstalledSources();
    const changed = {
      ...sources,
      androidControlsService: sources.androidControlsService.replace(
        "private fun resolveSessionPlayer",
        "private fun resolveChangedSessionPlayer",
      ),
    };

    expect(() => applyExpoAudioBackgroundSafety(changed)).toThrow(
      /Expo Audio 57\.0\.3 Android controls source changed/,
    );
  });
});
