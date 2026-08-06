/// <reference types="node" />

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyExpoAudioBackgroundSafety,
  applyExpoAudioPlaylistMediaSession,
  EXPO_AUDIO_BACKGROUND_SAFETY_MARKER,
  EXPO_AUDIO_VERSION,
  patchInstalledExpoAudio,
  type ExpoAudioPlaylistMediaSessionSources,
} from "../../scripts/expo-audio-background-safety";

const expoAudioRoot = path.dirname(require.resolve("expo-audio/package.json"));
const playlistPatchSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../patches/expo-audio-57.0.3-playlist-media-session.patch",
  ),
  "utf8",
);

const sourcePaths = {
  androidBaseAudioPlayer: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt",
  ),
  androidAudioPlaylist: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/AudioPlaylist.kt",
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
  androidPlaybackServiceConnection: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/service/AudioPlaybackServiceConnection.kt",
  ),
  androidMediaSessionCallback: path.join(
    expoAudioRoot,
    "android/src/main/java/expo/modules/audio/service/AudioMediaSessionCallback.kt",
  ),
  iosAudioPlaylist: path.join(expoAudioRoot, "ios/AudioPlaylist.swift"),
  iosAudioPlayer: path.join(expoAudioRoot, "ios/AudioPlayer.swift"),
  iosAudioModule: path.join(expoAudioRoot, "ios/AudioModule.swift"),
  iosMediaController: path.join(expoAudioRoot, "ios/MediaController.swift"),
  typescriptAudioModuleTypes: path.join(
    expoAudioRoot,
    "src/AudioModule.types.ts",
  ),
  builtAudioModuleTypes: path.join(
    expoAudioRoot,
    "build/AudioModule.types.d.ts",
  ),
} as const;

const readInstalledSources = (): ExpoAudioPlaylistMediaSessionSources =>
  Object.fromEntries(
    Object.entries(sourcePaths).map(([key, filePath]) => [
      key,
      fs.readFileSync(filePath, "utf8"),
    ]),
  ) as ExpoAudioPlaylistMediaSessionSources;

const fixtureRoots: string[] = [];

const createInstalledFixture = (
  sources: ExpoAudioPlaylistMediaSessionSources,
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
      sources[key as keyof ExpoAudioPlaylistMediaSessionSources],
    );
  }
  return projectRoot;
};

const readFixtureSources = (
  projectRoot: string,
): ExpoAudioPlaylistMediaSessionSources => {
  const packageRoot = path.join(projectRoot, "node_modules/expo-audio");
  return Object.fromEntries(
    Object.entries(sourcePaths).map(([key, installedPath]) => [
      key,
      fs.readFileSync(
        path.join(packageRoot, path.relative(expoAudioRoot, installedPath)),
        "utf8",
      ),
    ]),
  ) as ExpoAudioPlaylistMediaSessionSources;
};

const getInstalledState = (
  sources: ExpoAudioPlaylistMediaSessionSources,
): "background" | "patched" | "pristine" => {
  if (sources.androidAudioPlaylist.includes("isActiveForLockScreen")) {
    return "patched";
  }
  if (
    sources.androidBaseAudioPlayer.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)
  ) {
    return "background";
  }
  return "pristine";
};

const buildExpectedPatchedSources = (
  sources: ExpoAudioPlaylistMediaSessionSources,
): ExpoAudioPlaylistMediaSessionSources => {
  const state = getInstalledState(sources);
  if (state === "patched") {
    return sources;
  }
  const backgroundSources =
    state === "background"
      ? sources
      : { ...sources, ...applyExpoAudioBackgroundSafety(sources) };
  return applyExpoAudioPlaylistMediaSession(
    backgroundSources,
    playlistPatchSource,
  );
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
    const result = buildExpectedPatchedSources(readInstalledSources());

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
    const { androidControlsService } = buildExpectedPatchedSources(
      readInstalledSources(),
    );

    expect(androidControlsService).toContain("activePlayer.requestPlayback()");
    expect(androidControlsService).toContain("activePlayer.cancelPlayback()");
    expect(androidControlsService).toContain(
      "override fun play() = playback.requestPlayback()",
    );
    expect(androidControlsService).toContain(
      "override fun requestPlayback() = player.requestPlaybackFromSystemControls()",
    );
    expect(androidControlsService).toContain(
      "override fun setPlayWhenReady(playWhenReady: Boolean)",
    );
    expect(androidControlsService).toContain(
      "if (playWhenReady) {\n          playback.requestPlayback()",
    );
    expect(androidControlsService).toContain(
      "override fun pause() = playback.cancelPlayback()",
    );
    expect(androidControlsService).not.toMatch(
      /ACTION_PLAY[\s\S]{0,180}currentPlayerRef\.play\(\)/,
    );
  });

  it("removes every opaque iOS remote-command target before replacement", () => {
    const { iosMediaController } = buildExpectedPatchedSources(
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
    ).toHaveLength(8);
    expect(iosMediaController).not.toContain("removeTarget(self)");
  });

  it("keeps queue transitions, metadata, and previous/next commands native", () => {
    const result = buildExpectedPatchedSources(readInstalledSources());

    expect(result.androidAudioPlaylist).toContain(
      "internal val currentMetadata: Metadata?",
    );
    expect(result.androidAudioPlaylist).toContain(
      "internal var metadata: List<Metadata?>",
    );
    expect(result.androidAudioPlaylist).toContain(
      "private var playbackError: String? = null",
    );
    expect(result.androidAudioPlaylist).toContain('"error" to playbackError');
    expect(result.androidAudioPlaylist).toContain(
      "List(trackCount) { index -> metadata?.getOrNull(index) }",
    );
    expect(result.androidAudioPlaylist).toContain(
      "serviceBinder.service.setPlaylistOptions(this, this.metadata, options)",
    );
    expect(result.androidAudioModule).toContain(
      "playlist.onPlaybackRequested = { playWithAudioFocus(playlist) }",
    );
    expect(result.androidControlsService).toContain(
      "private sealed class LockScreenPlayback",
    );
    expect(result.androidControlsService).toContain(
      "ACTION_NEXT -> currentPlayerRef.seekToNextMediaItem()",
    );
    expect(result.androidControlsService).toContain(
      "override fun requestPlayback() = playlist.requestPlaybackFromSystemControls()",
    );
    expect(result.androidControlsService).toContain(
      "refreshCurrentMetadata(playback)",
    );
    expect(result.androidControlsService).toContain(
      "private fun clearSessionInternal(expected: BaseAudioPlayer? = null)",
    );
    expect(result.androidMediaSessionCallback).toContain(
      "private val allowTrackNavigation: Boolean",
    );
    expect(result.androidMediaSessionCallback).toContain(
      "Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM",
    );
    expect(result.androidPlaybackServiceConnection).toContain(
      "serviceBinder.service.setPlaylistOptions",
    );
    expect(result.androidPlaybackServiceConnection).toContain(
      "service?.disconnect(player.get())",
    );
    expect(result.androidPlaybackServiceConnection).not.toContain(
      "disconnect(player.get(), isReleased)",
    );
    expect(result.androidControlsService).toContain(
      "fun disconnect(source: BaseAudioPlayer?)",
    );
    expect(result.androidControlsService).not.toContain(
      "fun disconnect(source: BaseAudioPlayer?, released: Boolean)",
    );

    expect(result.iosAudioPlaylist).toContain(
      "var isActiveForLockScreen = false",
    );
    expect(result.iosAudioPlaylist).toContain(
      "private var playbackError: String?",
    );
    expect(result.iosAudioPlaylist).toContain("if status == .failed");
    expect(result.iosAudioPlaylist).toContain('"error": playbackError');
    expect(result.iosAudioPlaylist).toContain(
      "var currentLockScreenMetadata: Metadata?",
    );
    expect(result.iosAudioPlaylist).toContain(
      "private var lockScreenMetadata: [Metadata?]",
    );
    expect(result.iosAudioPlaylist).toContain(
      "MediaController.shared.clearActivePlaylist(self)",
    );
    expect(result.iosAudioPlayer).toContain(
      "MediaController.shared.clearActivePlayer(self)",
    );
    expect(result.iosAudioPlaylist).toContain(
      "MediaController.shared.updateNowPlayingInfo(for: self)",
    );
    expect(result.iosAudioPlaylist).toMatch(
      /if active \{\n      lockScreenMetadata = sources\.indices\.map/,
    );
    expect(result.iosMediaController).toContain(
      "remoteCommandCenter.previousTrackCommand",
    );
    expect(result.iosMediaController).toContain(
      "remoteCommandCenter.nextTrackCommand",
    );
    expect(result.iosMediaController).toContain(
      "guard activePlayer?.id == player.id else",
    );
    expect(result.iosMediaController).toContain(
      "private func clearActivePlayableOnMain",
    );
    expect(result.iosMediaController).toContain(
      "nowPlayingInfo.removeValue(forKey: MPMediaItemPropertyTitle)",
    );
    expect(result.iosMediaController).toContain(
      "nowPlayingInfo.removeValue(forKey: MPMediaItemPropertyArtist)",
    );
    expect(result.iosMediaController).toContain(
      "nowPlayingInfo.removeValue(forKey: MPMediaItemPropertyAlbumTitle)",
    );
    expect(
      result.iosMediaController.match(/remoteCommandTargets\.append/g),
    ).toHaveLength(8);
    expect(result.iosAudioModule).toContain(
      'Function("setActiveForLockScreen") { (playlist: AudioPlaylist',
    );

    expect(result.typescriptAudioModuleTypes).toContain(
      "setActiveForLockScreen(",
    );
    expect(result.builtAudioModuleTypes).toContain(
      "clearLockScreenControls(): void;",
    );
  });

  it("is idempotent after a clean prebuild has already applied it", () => {
    const once = applyExpoAudioBackgroundSafety(readInstalledSources());

    expect(applyExpoAudioBackgroundSafety(once)).toEqual(once);
  });

  it("checks without mutation and atomically replaces each preflighted file", () => {
    const original = readInstalledSources();
    const projectRoot = createInstalledFixture(original);
    const originalState = getInstalledState(original);

    expect(patchInstalledExpoAudio(projectRoot, "check")).toEqual({
      changed: false,
      state: originalState,
    });
    expect(readFixtureSources(projectRoot)).toEqual(original);

    patchInstalledExpoAudio(projectRoot, "apply");
    expect(readFixtureSources(projectRoot)).toEqual(
      buildExpectedPatchedSources(original),
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
      /does not match a reviewed pristine, background-only, or playlist-patched source hash/,
    );
    expect(readFixtureSources(changedSourceRoot)).toEqual(changedSources);
  });

  it("fails closed when the pinned native source contract changes", () => {
    const sources = readInstalledSources();
    const reviewedAnchor = sources.androidControlsService.includes(
      "private sealed class LockScreenPlayback",
    )
      ? "private sealed class LockScreenPlayback"
      : "private fun resolveSessionPlayer";
    const changed = {
      ...sources,
      androidControlsService: sources.androidControlsService.replace(
        reviewedAnchor,
        "private fun changedReviewedAnchor",
      ),
    };

    expect(() => applyExpoAudioBackgroundSafety(changed)).toThrow(
      /Expo Audio 57\.0\.3 Android controls source changed/,
    );
  });
});
