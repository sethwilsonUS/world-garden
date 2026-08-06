const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPO_AUDIO_VERSION = "57.0.3";
const EXPO_AUDIO_BACKGROUND_SAFETY_MARKER =
  "CurioGardenExpoAudioBackgroundSafetyBackport";
const EXPO_AUDIO_PLAYLIST_PATCH_PATH =
  require.resolve("../patches/expo-audio-57.0.3-playlist-media-session.patch");
const EXPO_AUDIO_PLAYLIST_PATCH_SHA256 =
  "ee4ed48c8c681e4a91c665aaa1c4a9516f8b1bbb74afced4b1b7cebee419d3fd";

const sourceFiles = {
  androidBaseAudioPlayer: {
    path: "android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt",
    sha256: "72048bf31c327cc05e469dc30362f4c1c7d7d61cd546eceada70b1ba49bd90a3",
    backgroundSha256:
      "5815ca17f28f1637a4f9196df263a1d717281cf9dd25b1ad25b4d4c49e23317f",
    patchedSha256:
      "5815ca17f28f1637a4f9196df263a1d717281cf9dd25b1ad25b4d4c49e23317f",
  },
  androidAudioPlaylist: {
    path: "android/src/main/java/expo/modules/audio/AudioPlaylist.kt",
    sha256: "9bdfdbce6292de8198b1776c6058601a292e8bef38354a784742ad4dfe830015",
    backgroundSha256:
      "9bdfdbce6292de8198b1776c6058601a292e8bef38354a784742ad4dfe830015",
    patchedSha256:
      "c95ba5e2a0828b7517a64f63def39f272435c5e96311b55a35882591870d48f5",
  },
  androidAudioModule: {
    path: "android/src/main/java/expo/modules/audio/AudioModule.kt",
    sha256: "637fe9bed875e47c3348a1f9623c4e049965efec2ebbe77cff6836c94544177a",
    backgroundSha256:
      "bc96dd85aaadd9248c13b9c174fc47b905bbf4078638204bfc565c6551d3a64f",
    patchedSha256:
      "d35c8a530a2743cdc49b66d246473e91f425cc5e3e67e395245178da54c9e9f7",
  },
  androidAudioPlayer: {
    path: "android/src/main/java/expo/modules/audio/AudioPlayer.kt",
    sha256: "636f4ef70dac17d7490ec5e99aa60d71dc7ce6d7b4b913c501001079d6b8f33e",
    backgroundSha256:
      "53b5a758e4df527ce10c244174fb3d1103166f2f30b8f958865a7c5b1c4cc1f7",
    patchedSha256:
      "3e5369ed819c64e37f47c293cf4a98569d3ffff55cde1b98e114b070541a054c",
  },
  androidPlaybackServiceConnection: {
    path: "android/src/main/java/expo/modules/audio/service/AudioPlaybackServiceConnection.kt",
    sha256: "463ddeeb72337e58ca389dfeffcb789a5ec62ab00a9ae146180c8676313f30d8",
    backgroundSha256:
      "463ddeeb72337e58ca389dfeffcb789a5ec62ab00a9ae146180c8676313f30d8",
    patchedSha256:
      "d6f015617297e46d7e6a7b0ae8ee5902945d50f6f7e86032b96a6410232561ee",
  },
  androidControlsService: {
    path: "android/src/main/java/expo/modules/audio/service/AudioControlsService.kt",
    sha256: "a39a43672602c9eda1c11b840fbe2984fd57f37dd7be2152d19271131c90fbb7",
    backgroundSha256:
      "f819c129b13c6937979f9c2de32a4d908d9876452952718ec7739ced6a20e503",
    patchedSha256:
      "f3fa08b51b9bf1329123d6d7d44f5b97567f61cb967d9bea54d08401c195cdb8",
  },
  androidMediaSessionCallback: {
    path: "android/src/main/java/expo/modules/audio/service/AudioMediaSessionCallback.kt",
    sha256: "ea488e034c20fd02053521a80d972e87f3cd8afc5bca762e5695498c66271073",
    backgroundSha256:
      "ea488e034c20fd02053521a80d972e87f3cd8afc5bca762e5695498c66271073",
    patchedSha256:
      "f8fdb3b4723f7ac8b1d29022d7dc26c1ab70b85bf367dbf4fc0a5ec0b9cfc098",
  },
  iosAudioPlaylist: {
    path: "ios/AudioPlaylist.swift",
    sha256: "5c990cc4f73454ab1ec00b189beab2c3f32968b4bb75a7751fe8d438094af81f",
    backgroundSha256:
      "5c990cc4f73454ab1ec00b189beab2c3f32968b4bb75a7751fe8d438094af81f",
    patchedSha256:
      "74bead81dbf188c4a12919acce61e4d9050d18bbf627c7436f0a6a804eea55a6",
  },
  iosAudioPlayer: {
    path: "ios/AudioPlayer.swift",
    sha256: "ec25a72a075180123437450350e7eed1ab7ef669645ebed901c4470c039ee41c",
    backgroundSha256:
      "ec25a72a075180123437450350e7eed1ab7ef669645ebed901c4470c039ee41c",
    patchedSha256:
      "1ebea5cb64e78f049cb77e8d16ed7ac2e41769564830d3daa0c2fd301e7137a9",
  },
  iosAudioModule: {
    path: "ios/AudioModule.swift",
    sha256: "988bad3ed7eadf2b79d0de2a02529862e7e04cf5d52c9e8ddb65b55acb133e52",
    backgroundSha256:
      "988bad3ed7eadf2b79d0de2a02529862e7e04cf5d52c9e8ddb65b55acb133e52",
    patchedSha256:
      "a1f03206d6d8950431cdfd6b51e05ad125715ba6a1a387a42a45a0a83d5ffcdc",
  },
  iosMediaController: {
    path: "ios/MediaController.swift",
    sha256: "8a1d895f13afe02f291a7db1050c4e74b176963598ced7e83213c3fb7ba3d604",
    backgroundSha256:
      "275f31f6a01f9180f607f368eece724473bb9c088312199d98393c3efef88018",
    patchedSha256:
      "5066fcc08cb514d4472b9e54efea858aeec0316d0ab59d555cd99abb07aea4a4",
  },
  typescriptAudioModuleTypes: {
    path: "src/AudioModule.types.ts",
    sha256: "fc581e960ba8ab5f9085abd3119caa30f2b48c25334a898944ca25025af9bc13",
    backgroundSha256:
      "fc581e960ba8ab5f9085abd3119caa30f2b48c25334a898944ca25025af9bc13",
    patchedSha256:
      "12ae85bd20846afc92cd9418705c4b97e57f1c68e50e57206a9a0b91a0d5c024",
  },
  builtAudioModuleTypes: {
    path: "build/AudioModule.types.d.ts",
    sha256: "a9a11ff056e9577525f0663ccdc6a4155ecbd98b48a0dd666b2eea7768cf959c",
    backgroundSha256:
      "a9a11ff056e9577525f0663ccdc6a4155ecbd98b48a0dd666b2eea7768cf959c",
    patchedSha256:
      "5114adcc4b7316dc6080c2ea91f11f1f49b6fcb58896878b57b765849657735c",
  },
};

const count = (source, value) => source.split(value).length - 1;

const replaceExactly = (source, before, after, label) => {
  if (count(source, before) !== 1) {
    throw new Error(
      `Expo Audio ${EXPO_AUDIO_VERSION} ${label} source changed; review or remove the Curio Garden backport before building.`,
    );
  }
  return source.replace(before, after);
};

const assertContains = (source, values, label) => {
  if (values.some((value) => !source.includes(value))) {
    throw new Error(
      `Expo Audio ${EXPO_AUDIO_VERSION} ${label} source changed; the existing Curio Garden backport is incomplete.`,
    );
  }
};

const applyAndroidBaseAudioPlayerSafety = (source) => {
  if (source.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)) {
    assertContains(
      source,
      [
        "internal var waitingForAudioFocus = false",
        "internal fun reportPlaybackNotStarted()",
        'sendStatusUpdate(mapOf("playing" to false))',
      ],
      "Android base player",
    );
    return source;
  }

  let result = replaceExactly(
    source,
    `  override var onPlaybackStateChange: ((Boolean) -> Unit)? = null
  override val player get() = ref`,
    `  override var onPlaybackStateChange: ((Boolean) -> Unit)? = null
  // ${EXPO_AUDIO_BACKGROUND_SAFETY_MARKER}
  internal var waitingForAudioFocus = false
  override val player get() = ref`,
    "Android base player",
  );

  result = replaceExactly(
    result,
    `  protected fun sendStatusUpdate(map: Map<String, Any?>? = null) {
    val data = currentStatus()
    val body = map?.let { data + it } ?: data
    emit(statusEventName, body)
  }
`,
    `  protected fun sendStatusUpdate(map: Map<String, Any?>? = null) {
    val data = currentStatus()
    val body = map?.let { data + it } ?: data
    emit(statusEventName, body)
  }

  internal fun reportPlaybackNotStarted() {
    intendedPlayingState = false
    sendStatusUpdate(mapOf("playing" to false))
  }
`,
    "Android base player",
  );

  return result;
};

const applyAndroidAudioModuleSafety = (source) => {
  if (source.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)) {
    assertContains(
      source,
      [
        "private fun playWithAudioFocus(playable: BaseAudioPlayer)",
        "private fun cancelPlayback(playable: BaseAudioPlayer)",
        "playable.isPaused = false",
        "AudioFocusRequestResult.DELAYED",
        "focusRequestPending = true",
        "it.player.playWhenReady || it.waitingForAudioFocus || it.isPaused",
        "if (shouldReleaseFocus()) {\n      releaseAudioFocus()",
        "if (shouldReleaseFocus()) {\n            releaseAudioFocus()",
        "player.onPlaybackRequested = { playWithAudioFocus(player) }",
        "player.onPlaybackCancelled = { cancelPlayback(player) }",
        "playWithAudioFocus(playlist)",
        "cancelPlayback(playlist)",
      ],
      "Android module",
    );
    return source;
  }

  let result = replaceExactly(
    source,
    `@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioModule : Module() {`,
    `private enum class AudioFocusRequestResult {
  GRANTED,
  DELAYED,
  DENIED
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioModule : Module() {`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `  private var focusAcquired = false
  private var interruptionMode: InterruptionMode? = null`,
    `  private var focusAcquired = false
  private var focusRequestPending = false
  private var interruptionMode: InterruptionMode? = null`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `  private val allPlayables: Sequence<Playable>
    get() = players.values.asSequence() + playlists.values.asSequence()`,
    `  private val allPlayables: Sequence<BaseAudioPlayer>
    get() = players.values.asSequence() + playlists.values.asSequence()`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `  private fun requestAudioFocus() {
    if (focusAcquired || !audioEnabled || interruptionMode == InterruptionMode.MIX_WITH_OTHERS) {
      return
    }

    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val requestType = interruptionMode?.let {
        if (it == InterruptionMode.DO_NOT_MIX) {
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        } else {
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
        }
      } ?: AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      audioFocusRequest = AudioFocusRequest.Builder(requestType).run {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        setAcceptsDelayedFocusGain(true)
        setOnAudioFocusChangeListener(audioFocusChangeListener)
        build()
      }
      audioFocusRequest?.let {
        audioManager.requestAudioFocus(it)
      }
    } else {
      @Suppress("DEPRECATION")
      val requestType = if (interruptionMode == InterruptionMode.DO_NOT_MIX) {
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      } else {
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      }
      audioManager.requestAudioFocus(audioFocusChangeListener, AudioManager.STREAM_MUSIC, requestType)
    }

    if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      focusAcquired = true
    } else {
      Log.e(TAG, "Audio focus request failed with: $result")
    }
  }
`,
    `  private fun requestAudioFocus(): AudioFocusRequestResult {
    if (focusAcquired || interruptionMode == InterruptionMode.MIX_WITH_OTHERS) {
      return AudioFocusRequestResult.GRANTED
    }
    if (focusRequestPending) {
      return AudioFocusRequestResult.DELAYED
    }
    if (!audioEnabled) {
      return AudioFocusRequestResult.DENIED
    }

    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val requestType = interruptionMode?.let {
        if (it == InterruptionMode.DO_NOT_MIX) {
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        } else {
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
        }
      } ?: AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      val request = AudioFocusRequest.Builder(requestType).run {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        setAcceptsDelayedFocusGain(true)
        setOnAudioFocusChangeListener(audioFocusChangeListener)
        build()
      }
      audioFocusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      val requestType = if (interruptionMode == InterruptionMode.DO_NOT_MIX) {
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      } else {
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      }
      audioManager.requestAudioFocus(audioFocusChangeListener, AudioManager.STREAM_MUSIC, requestType)
    }

    return when (result) {
      AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> {
        focusAcquired = true
        focusRequestPending = false
        AudioFocusRequestResult.GRANTED
      }
      AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> {
        focusAcquired = false
        focusRequestPending = true
        AudioFocusRequestResult.DELAYED
      }
      else -> {
        focusAcquired = false
        focusRequestPending = false
        Log.e(TAG, "Audio focus request failed with: $result")
        AudioFocusRequestResult.DENIED
      }
    }
  }

  // ${EXPO_AUDIO_BACKGROUND_SAFETY_MARKER}
  // Keep Expo's module as the sole focus owner, including system transport controls.
  private fun playWithAudioFocus(playable: BaseAudioPlayer) {
    if (!audioEnabled) {
      playable.waitingForAudioFocus = false
      playable.reportPlaybackNotStarted()
      Log.e(TAG, "Audio has been disabled. Re-enable to start playing")
      return
    }
    if (!shouldPlayInSilentMode()) {
      playable.waitingForAudioFocus = false
      playable.reportPlaybackNotStarted()
      return
    }

    when (requestAudioFocus()) {
      AudioFocusRequestResult.GRANTED -> {
        playable.waitingForAudioFocus = false
        playable.isPaused = false
        playable.play()
      }
      AudioFocusRequestResult.DELAYED -> {
        playable.waitingForAudioFocus = true
        playable.reportPlaybackNotStarted()
      }
      AudioFocusRequestResult.DENIED -> {
        playable.waitingForAudioFocus = false
        playable.reportPlaybackNotStarted()
      }
    }
  }

  private fun cancelPlayback(playable: BaseAudioPlayer) {
    playable.waitingForAudioFocus = false
    playable.isPaused = false
    playable.pause()
    playable.reportPlaybackNotStarted()
    if (shouldReleaseFocus()) {
      releaseAudioFocus()
    }
  }
`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `        AudioManager.AUDIOFOCUS_LOSS -> {
          focusAcquired = false
          allPlayables.forEach { it.pause() }
        }`,
    `        AudioManager.AUDIOFOCUS_LOSS -> {
          focusAcquired = false
          focusRequestPending = false
          allPlayables.forEach {
            it.waitingForAudioFocus = false
            it.isPaused = false
            it.pause()
          }
        }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
          focusAcquired = false
          allPlayables.forEach { playable ->`,
    `        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
          focusAcquired = false
          focusRequestPending = false
          allPlayables.forEach { playable ->
            if (playable.waitingForAudioFocus) {
              playable.waitingForAudioFocus = false
              playable.reportPlaybackNotStarted()
            }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `        AudioManager.AUDIOFOCUS_GAIN -> {
          focusAcquired = true

          if (!shouldPlayInSilentMode()) {`,
    `        AudioManager.AUDIOFOCUS_GAIN -> {
          focusAcquired = true
          focusRequestPending = false

          if (!shouldPlayInSilentMode()) {`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `          allPlayables.forEach { playable ->
            playable.setVolume(playable.previousVolume)
            if (playable.isPaused) {`,
    `          allPlayables.filter { it.waitingForAudioFocus }.toList().forEach { playable ->
            playable.waitingForAudioFocus = false
            playable.play()
          }

          allPlayables.forEach { playable ->
            playable.setVolume(playable.previousVolume)
            if (playable.isPaused) {`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `          allPlayables.forEach { playable ->
            playable.setVolume(playable.previousVolume)
            if (playable.isPaused) {
              playable.isPaused = false
              playable.play()
            }
          }
        }`,
    `          allPlayables.forEach { playable ->
            playable.setVolume(playable.previousVolume)
            if (playable.isPaused) {
              playable.isPaused = false
              playable.play()
            }
          }

          if (shouldReleaseFocus()) {
            releaseAudioFocus()
          }
        }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `  private fun shouldReleaseFocus(): Boolean {
    return allPlayables.none { it.isPlaying }
  }`,
    `  private fun shouldReleaseFocus(): Boolean {
    return allPlayables.none { it.player.playWhenReady || it.waitingForAudioFocus || it.isPaused }
  }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `  private fun releaseAudioFocus() {
    if (!focusAcquired) {
      return
    }`,
    `  private fun releaseAudioFocus() {
    if (!focusAcquired && !focusRequestPending) {
      return
    }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `    focusAcquired = false
  }
`,
    `    focusAcquired = false
    focusRequestPending = false
  }
`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `        if (allPlayables.any { it.isPaused }) {
          requestAudioFocus()
        }

        allPlayables.forEach { playable ->
          if (playable.isPaused) {
            playable.isPaused = false
            playable.play()
          }
        }`,
    `        allPlayables.filter { it.isPaused }.forEach { playable ->
          playWithAudioFocus(playable)
        }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `          player.onPlaybackStateChange = { isPlaying ->
            if (!isPlaying && shouldReleaseFocus()) {
              releaseAudioFocus()
            }
          }
          players[player.id] = player`,
    `          player.onPlaybackStateChange = { isPlaying ->
            if (!isPlaying && shouldReleaseFocus()) {
              releaseAudioFocus()
            }
          }
          player.onPlaybackRequested = { playWithAudioFocus(player) }
          player.onPlaybackCancelled = { cancelPlayback(player) }
          players[player.id] = player`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `      Function("play") { player: AudioPlayer ->
        if (!audioEnabled) {
          Log.e(TAG, "Audio has been disabled. Re-enable to start playing")
          return@Function
        }
        if (!shouldPlayInSilentMode()) {
          return@Function
        }
        runOnMain {
          if (!focusAcquired) {
            requestAudioFocus()
          }
          player.ref.play()
        }
      }`,
    `      Function("play") { player: AudioPlayer ->
        runOnMain {
          playWithAudioFocus(player)
        }
      }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `      Function("pause") { player: AudioPlayer ->
        runOnMain {
          player.ref.pause()
        }
      }`,
    `      Function("pause") { player: AudioPlayer ->
        runOnMain {
          cancelPlayback(player)
        }
      }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `              if (wasPlaying) {
                if (!shouldPlayInSilentMode()) {
                  return@runOnMain
                }
                if (!focusAcquired) {
                  requestAudioFocus()
                }
                player.ref.play()
              }`,
    `              if (wasPlaying) {
                playWithAudioFocus(player)
              }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `      Function("play") { playlist: AudioPlaylist ->
        if (!audioEnabled) {
          Log.e(TAG, "Audio has been disabled. Re-enable to start playing")
          return@Function
        }
        if (!shouldPlayInSilentMode()) {
          return@Function
        }
        runOnMain {
          if (!focusAcquired) {
            requestAudioFocus()
          }
          playlist.ref.play()
        }
      }`,
    `      Function("play") { playlist: AudioPlaylist ->
        runOnMain {
          playWithAudioFocus(playlist)
        }
      }`,
    "Android module",
  );

  result = replaceExactly(
    result,
    `      Function("pause") { playlist: AudioPlaylist ->
        runOnMain {
          playlist.ref.pause()
        }
      }`,
    `      Function("pause") { playlist: AudioPlaylist ->
        runOnMain {
          cancelPlayback(playlist)
        }
      }`,
    "Android module",
  );

  return result;
};

const applyAndroidAudioPlayerSafety = (source) => {
  if (source.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)) {
    assertContains(
      source,
      [
        "internal var onPlaybackRequested: (() -> Unit)? = null",
        "internal var onPlaybackCancelled: (() -> Unit)? = null",
        "internal fun requestPlaybackFromSystemControls()",
        "internal fun cancelPlaybackFromSystemControls()",
        "onPlaybackCancelled?.invoke()",
        "onPlaybackRequested = null",
      ],
      "Android player",
    );
    return source;
  }

  let result = replaceExactly(
    source,
    `  val serviceConnection = AudioPlaybackServiceConnection(WeakReference(this), appContext)
`,
    `  val serviceConnection = AudioPlaybackServiceConnection(WeakReference(this), appContext)

  // ${EXPO_AUDIO_BACKGROUND_SAFETY_MARKER}
  internal var onPlaybackRequested: (() -> Unit)? = null
  internal var onPlaybackCancelled: (() -> Unit)? = null
`,
    "Android player",
  );

  result = replaceExactly(
    result,
    `  val currentOffsetFromLive: Double?
    get() {
      val offset = ref.currentLiveOffset
      return if (offset == C.TIME_UNSET) null else offset / 1000.0
    }
`,
    `  val currentOffsetFromLive: Double?
    get() {
      val offset = ref.currentLiveOffset
      return if (offset == C.TIME_UNSET) null else offset / 1000.0
    }

  internal fun requestPlaybackFromSystemControls() {
    onPlaybackRequested?.invoke()
  }

  internal fun cancelPlaybackFromSystemControls() {
    onPlaybackCancelled?.invoke()
  }
`,
    "Android player",
  );

  result = replaceExactly(
    result,
    `  override fun sharedObjectDidRelease() {
    serviceConnection.release()
    super.sharedObjectDidRelease()
  }`,
    `  override fun sharedObjectDidRelease() {
    onPlaybackCancelled?.invoke()
    onPlaybackRequested = null
    onPlaybackCancelled = null
    serviceConnection.release()
    super.sharedObjectDidRelease()
  }`,
    "Android player",
  );

  return result;
};

const applyAndroidControlsSafety = (source) => {
  if (source.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)) {
    const backgroundOnlyShape = [
      "private fun resolveSessionPlayer",
      "activePlayer.requestPlaybackFromSystemControls()",
      "activePlayer.cancelPlaybackFromSystemControls()",
      "override fun play()",
      "override fun pause()",
      "override fun setPlayWhenReady(playWhenReady: Boolean)",
    ];
    const playlistShape = [
      "private sealed class LockScreenPlayback",
      "activePlayer.requestPlayback()",
      "activePlayer.cancelPlayback()",
      "override fun play() = playback.requestPlayback()",
      "override fun pause() = playback.cancelPlayback()",
      "override fun setPlayWhenReady(playWhenReady: Boolean)",
    ];
    if (
      !backgroundOnlyShape.every((value) => source.includes(value)) &&
      !playlistShape.every((value) => source.includes(value))
    ) {
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} Android controls source changed; the existing Curio Garden backport is incomplete.`,
      );
    }
    return source;
  }

  let result = replaceExactly(
    source,
    `    val currentPlayerRef = currentPlayer?.ref
    val context = appContext
    if (currentPlayerRef == null || context == null) {`,
    `    val activePlayer = currentPlayer
    val currentPlayerRef = activePlayer?.ref
    val context = appContext
    if (activePlayer == null || currentPlayerRef == null || context == null) {`,
    "Android controls",
  );

  result = replaceExactly(
    result,
    `        ACTION_PLAY -> {
          if (shouldPlayInSilentMode()) {
            currentPlayerRef.play()
          }
        }`,
    `        ACTION_PLAY -> {
          if (shouldPlayInSilentMode()) {
            activePlayer.requestPlaybackFromSystemControls()
          }
        }`,
    "Android controls",
  );

  result = replaceExactly(
    result,
    `        ACTION_PAUSE -> currentPlayerRef.pause()`,
    `        ACTION_PAUSE -> activePlayer.cancelPlaybackFromSystemControls()`,
    "Android controls",
  );

  result = replaceExactly(
    result,
    `          if (currentPlayerRef.isPlaying) {
            currentPlayerRef.pause()
          } else if (shouldPlayInSilentMode()) {`,
    `          if (currentPlayerRef.isPlaying) {
            activePlayer.cancelPlaybackFromSystemControls()
          } else if (shouldPlayInSilentMode()) {`,
    "Android controls",
  );

  result = replaceExactly(
    result,
    `          } else if (shouldPlayInSilentMode()) {
            currentPlayerRef.play()
          }`,
    `          } else if (shouldPlayInSilentMode()) {
            activePlayer.requestPlaybackFromSystemControls()
          }`,
    "Android controls",
  );

  result = replaceExactly(
    result,
    `  private fun resolveSessionPlayer(player: AudioPlayer, options: AudioLockScreenOptions?): Player {
    val isLive = options?.isLiveStream ?: player.isLive
    if (!isLive) {
      return player.ref
    }

    return object : ForwardingPlayer(player.ref) {
      override fun getAvailableCommands(): Player.Commands {
        return super.getAvailableCommands().buildUpon()
          .remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
          .build()
      }
    }
  }`,
    `  // ${EXPO_AUDIO_BACKGROUND_SAFETY_MARKER}
  private fun resolveSessionPlayer(player: AudioPlayer, options: AudioLockScreenOptions?): Player {
    val isLive = options?.isLiveStream ?: player.isLive

    return object : ForwardingPlayer(player.ref) {
      override fun play() {
        player.requestPlaybackFromSystemControls()
      }

      override fun pause() {
        player.cancelPlaybackFromSystemControls()
      }

      override fun setPlayWhenReady(playWhenReady: Boolean) {
        if (playWhenReady) {
          player.requestPlaybackFromSystemControls()
        } else {
          player.cancelPlaybackFromSystemControls()
        }
      }

      override fun getAvailableCommands(): Player.Commands {
        val commands = super.getAvailableCommands()
        return if (isLive) {
          commands.buildUpon()
            .remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
            .build()
        } else {
          commands
        }
      }
    }
  }`,
    "Android controls",
  );

  return result;
};

const applyIosMediaControllerSafety = (source) => {
  if (source.includes(EXPO_AUDIO_BACKGROUND_SAFETY_MARKER)) {
    assertContains(
      source,
      [
        "private var remoteCommandTargets: [(command: MPRemoteCommand, target: Any)] = []",
        "command.removeTarget(target)",
        "remoteCommandTargets.removeAll()",
      ],
      "iOS media controller",
    );
    if (source.includes("removeTarget(self)")) {
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} iOS media controller source changed; the existing Curio Garden backport still contains unsafe target removal.`,
      );
    }
    return source;
  }

  let result = replaceExactly(
    source,
    `  private var nowPlayingInfoCenter = MPNowPlayingInfoCenter.default()
`,
    `  private var nowPlayingInfoCenter = MPNowPlayingInfoCenter.default()
  // ${EXPO_AUDIO_BACKGROUND_SAFETY_MARKER}
  private var remoteCommandTargets: [(command: MPRemoteCommand, target: Any)] = []
`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `  private func enableRemoteCommands(options: LockScreenOptions?) {
    remoteCommandCenter.playCommand.addTarget`,
    `  private func enableRemoteCommands(options: LockScreenOptions?) {
    removeRemoteCommandTargets()

    let playTarget = remoteCommandCenter.playCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.pauseCommand.addTarget`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.playCommand, playTarget))

    let pauseTarget = remoteCommandCenter.pauseCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.togglePlayPauseCommand.addTarget`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.pauseCommand, pauseTarget))

    let togglePlayPauseTarget = remoteCommandCenter.togglePlayPauseCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.changePlaybackPositionCommand.addTarget`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.togglePlayPauseCommand, togglePlayPauseTarget))

    let changePlaybackPositionTarget = remoteCommandCenter.changePlaybackPositionCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.skipForwardCommand.preferredIntervals`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.changePlaybackPositionCommand, changePlaybackPositionTarget))

    remoteCommandCenter.skipForwardCommand.preferredIntervals`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `    remoteCommandCenter.skipForwardCommand.addTarget`,
    `    let skipForwardTarget = remoteCommandCenter.skipForwardCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.skipBackwardCommand.preferredIntervals`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.skipForwardCommand, skipForwardTarget))

    remoteCommandCenter.skipBackwardCommand.preferredIntervals`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `    remoteCommandCenter.skipBackwardCommand.addTarget`,
    `    let skipBackwardTarget = remoteCommandCenter.skipBackwardCommand.addTarget`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `      return .success
    }

    remoteCommandCenter.playCommand.isEnabled`,
    `      return .success
    }
    remoteCommandTargets.append((remoteCommandCenter.skipBackwardCommand, skipBackwardTarget))

    remoteCommandCenter.playCommand.isEnabled`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `  private func disableRemoteCommands() {`,
    `  private func removeRemoteCommandTargets() {
    remoteCommandTargets.forEach { command, target in
      command.removeTarget(target)
    }
    remoteCommandTargets.removeAll()
  }

  private func disableRemoteCommands() {`,
    "iOS media controller",
  );

  result = replaceExactly(
    result,
    `
    // Remove event targets
    remoteCommandCenter.playCommand.removeTarget(self)
    remoteCommandCenter.pauseCommand.removeTarget(self)
    remoteCommandCenter.togglePlayPauseCommand.removeTarget(self)
    remoteCommandCenter.changePlaybackPositionCommand.removeTarget(self)
    remoteCommandCenter.skipForwardCommand.removeTarget(self)
    remoteCommandCenter.skipBackwardCommand.removeTarget(self)`,
    `
    removeRemoteCommandTargets()`,
    "iOS media controller",
  );

  return result;
};

const applyExpoAudioBackgroundSafety = (sources) => ({
  androidBaseAudioPlayer: applyAndroidBaseAudioPlayerSafety(
    sources.androidBaseAudioPlayer,
  ),
  androidAudioModule: applyAndroidAudioModuleSafety(sources.androidAudioModule),
  androidAudioPlayer: applyAndroidAudioPlayerSafety(sources.androidAudioPlayer),
  androidControlsService: applyAndroidControlsSafety(
    sources.androidControlsService,
  ),
  iosMediaController: applyIosMediaControllerSafety(sources.iosMediaController),
});

const parseUnifiedDiff = (patchSource) => {
  const lines = patchSource.replace(/\r\n/g, "\n").split("\n");
  const files = new Map();
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("diff --git ")) {
      index += 1;
      continue;
    }

    index += 1;
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      if (lines[index].startsWith("diff --git ")) {
        throw new Error("Expo Audio playlist patch is missing file headers.");
      }
      index += 1;
    }

    const oldHeader = lines[index];
    const newHeader = lines[index + 1];
    if (!oldHeader?.startsWith("--- a/") || !newHeader?.startsWith("+++ b/")) {
      throw new Error("Expo Audio playlist patch has invalid file headers.");
    }

    const oldPath = oldHeader.slice("--- a/".length);
    const newPath = newHeader.slice("+++ b/".length);
    if (oldPath !== newPath || files.has(oldPath)) {
      throw new Error(
        `Expo Audio playlist patch has an invalid or duplicate path: ${oldPath}.`,
      );
    }

    index += 2;
    const hunks = [];
    while (index < lines.length && !lines[index].startsWith("diff --git ")) {
      if (!lines[index].startsWith("@@ ")) {
        index += 1;
        continue;
      }

      const header = lines[index];
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
      if (!match) {
        throw new Error(
          `Expo Audio playlist patch has an invalid hunk header: ${header}.`,
        );
      }
      index += 1;

      const hunkLines = [];
      while (
        index < lines.length &&
        !lines[index].startsWith("@@ ") &&
        !lines[index].startsWith("diff --git ")
      ) {
        const line = lines[index];
        if (
          line.startsWith(" ") ||
          line.startsWith("+") ||
          line.startsWith("-") ||
          line === "\\ No newline at end of file"
        ) {
          hunkLines.push(line);
        } else if (line !== "") {
          throw new Error(
            `Expo Audio playlist patch has an invalid hunk line in ${oldPath}.`,
          );
        }
        index += 1;
      }

      hunks.push({
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? "1"),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? "1"),
        lines: hunkLines,
      });
    }

    if (hunks.length === 0) {
      throw new Error(`Expo Audio playlist patch has no hunks for ${oldPath}.`);
    }
    files.set(oldPath, hunks);
  }

  return files;
};

const applyUnifiedDiffToSource = (source, hunks, filePath) => {
  const sourceLines = source.split("\n");
  const result = [];
  let sourceIndex = 0;
  let patchedFileHasTerminalNewline;

  for (const hunk of hunks) {
    const hunkStart = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (hunkStart < sourceIndex || hunkStart > sourceLines.length) {
      throw new Error(
        `Expo Audio playlist patch hunk is out of order for ${filePath}.`,
      );
    }
    result.push(...sourceLines.slice(sourceIndex, hunkStart));
    sourceIndex = hunkStart;

    let consumedOldLines = 0;
    let producedNewLines = 0;
    let previousOperation;
    for (const patchLine of hunk.lines) {
      if (patchLine === "\\ No newline at end of file") {
        if (previousOperation === "+" || previousOperation === " ") {
          patchedFileHasTerminalNewline = false;
        } else if (previousOperation === "-") {
          patchedFileHasTerminalNewline = true;
        }
        continue;
      }

      const operation = patchLine[0];
      previousOperation = operation;
      const content = patchLine.slice(1);
      if (operation === " " || operation === "-") {
        if (sourceLines[sourceIndex] !== content) {
          throw new Error(
            `Expo Audio playlist patch context did not match ${filePath}.`,
          );
        }
        sourceIndex += 1;
        consumedOldLines += 1;
      }
      if (operation === " " || operation === "+") {
        result.push(content);
        producedNewLines += 1;
      }
    }

    if (
      consumedOldLines !== hunk.oldCount ||
      producedNewLines !== hunk.newCount
    ) {
      throw new Error(
        `Expo Audio playlist patch line counts did not match ${filePath}.`,
      );
    }
  }

  result.push(...sourceLines.slice(sourceIndex));
  let patchedSource = result.join("\n");
  if (patchedFileHasTerminalNewline === true && !patchedSource.endsWith("\n")) {
    patchedSource += "\n";
  } else if (
    patchedFileHasTerminalNewline === false &&
    patchedSource.endsWith("\n")
  ) {
    patchedSource = patchedSource.slice(0, -1);
  }
  return patchedSource;
};

const applyExpoAudioPlaylistMediaSession = (sources, patchSource) => {
  const patchFiles = parseUnifiedDiff(patchSource);
  const expectedPaths = new Set(
    Object.values(sourceFiles)
      .filter(
        (contract) => contract.backgroundSha256 !== contract.patchedSha256,
      )
      .map((contract) => contract.path),
  );

  if (
    patchFiles.size !== expectedPaths.size ||
    [...patchFiles.keys()].some((filePath) => !expectedPaths.has(filePath))
  ) {
    throw new Error(
      "Expo Audio playlist patch paths do not match the reviewed source contract.",
    );
  }

  const result = { ...sources };
  for (const [filePath, hunks] of patchFiles) {
    const entry = Object.entries(sourceFiles).find(
      ([, contract]) => contract.path === filePath,
    );
    if (!entry) {
      throw new Error(
        `Expo Audio playlist patch includes an unreviewed path: ${filePath}.`,
      );
    }
    const [key] = entry;
    result[key] = applyUnifiedDiffToSource(sources[key], hunks, filePath);
  }

  return result;
};

const sha256 = (source) =>
  crypto.createHash("sha256").update(source).digest("hex");

const writeAtomically = (filePath, source) => {
  const temporaryPath = `${filePath}.curio-garden-${process.pid}.tmp`;
  const mode = fs.statSync(filePath).mode;
  try {
    fs.writeFileSync(temporaryPath, source, { mode });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
};

const patchInstalledExpoAudio = (projectRoot, mode = "apply") => {
  if (mode !== "apply" && mode !== "check") {
    throw new Error(`Unsupported Expo Audio patch mode: ${mode}`);
  }

  const packageJsonPath = require.resolve("expo-audio/package.json", {
    paths: [projectRoot],
  });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== EXPO_AUDIO_VERSION) {
    throw new Error(
      `Expected expo-audio ${EXPO_AUDIO_VERSION}, received ${packageJson.version}; review or remove the Curio Garden native backport before building.`,
    );
  }

  const packageRoot = path.dirname(packageJsonPath);
  const paths = Object.fromEntries(
    Object.entries(sourceFiles).map(([key, value]) => [
      key,
      path.join(packageRoot, value.path),
    ]),
  );
  const sources = Object.fromEntries(
    Object.entries(paths).map(([key, filePath]) => [
      key,
      fs.readFileSync(filePath, "utf8"),
    ]),
  );

  const patchSource = fs.readFileSync(EXPO_AUDIO_PLAYLIST_PATCH_PATH, "utf8");
  if (sha256(patchSource) !== EXPO_AUDIO_PLAYLIST_PATCH_SHA256) {
    throw new Error(
      "Expo Audio playlist patch does not match its reviewed hash; refusing to continue.",
    );
  }

  const actualHashes = Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [key, sha256(source)]),
  );
  for (const [key, actualSha256] of Object.entries(actualHashes)) {
    const contract = sourceFiles[key];
    if (
      ![
        contract.sha256,
        contract.backgroundSha256,
        contract.patchedSha256,
      ].includes(actualSha256)
    ) {
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} ${contract.path} does not match a reviewed pristine, background-only, or playlist-patched source hash; refusing to continue.`,
      );
    }
  }

  const matchingStates = [
    ["pristine", "sha256"],
    ["background", "backgroundSha256"],
    ["patched", "patchedSha256"],
  ].filter(([, hashKey]) =>
    Object.entries(actualHashes).every(
      ([key, actualSha256]) => actualSha256 === sourceFiles[key][hashKey],
    ),
  );
  if (matchingStates.length !== 1) {
    throw new Error(
      `Expo Audio ${EXPO_AUDIO_VERSION} has a partial Curio Garden backport; reinstall dependencies before retrying.`,
    );
  }

  const state = matchingStates[0][0];
  let backgroundSources = sources;
  if (state === "pristine") {
    backgroundSources = {
      ...sources,
      ...applyExpoAudioBackgroundSafety(sources),
    };
    for (const [key, source] of Object.entries(backgroundSources)) {
      if (sha256(source) !== sourceFiles[key].backgroundSha256) {
        throw new Error(
          `Expo Audio ${EXPO_AUDIO_VERSION} ${sourceFiles[key].path} did not produce the reviewed background-safety hash; refusing to write any files.`,
        );
      }
    }
  }

  const patched =
    state === "patched"
      ? sources
      : applyExpoAudioPlaylistMediaSession(backgroundSources, patchSource);
  for (const [key, source] of Object.entries(patched)) {
    if (sha256(source) !== sourceFiles[key].patchedSha256) {
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} ${sourceFiles[key].path} did not produce the reviewed patched hash; refusing to write any files.`,
      );
    }
  }

  const shouldWrite = mode === "apply" && state !== "patched";
  if (shouldWrite) {
    for (const [key, source] of Object.entries(patched)) {
      writeAtomically(paths[key], source);
    }
    for (const [key, filePath] of Object.entries(paths)) {
      if (
        sha256(fs.readFileSync(filePath, "utf8")) !==
        sourceFiles[key].patchedSha256
      ) {
        throw new Error(
          `Expo Audio ${EXPO_AUDIO_VERSION} ${sourceFiles[key].path} failed post-write verification.`,
        );
      }
    }
  }

  return { changed: shouldWrite, state };
};

module.exports.applyExpoAudioBackgroundSafety = applyExpoAudioBackgroundSafety;
module.exports.applyExpoAudioPlaylistMediaSession =
  applyExpoAudioPlaylistMediaSession;
module.exports.patchInstalledExpoAudio = patchInstalledExpoAudio;
module.exports.EXPO_AUDIO_VERSION = EXPO_AUDIO_VERSION;
module.exports.EXPO_AUDIO_BACKGROUND_SAFETY_MARKER =
  EXPO_AUDIO_BACKGROUND_SAFETY_MARKER;
