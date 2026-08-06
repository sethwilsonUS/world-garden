const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPO_AUDIO_VERSION = "57.0.3";
const EXPO_AUDIO_BACKGROUND_SAFETY_MARKER =
  "CurioGardenExpoAudioBackgroundSafetyBackport";

const sourceFiles = {
  androidBaseAudioPlayer: {
    path: "android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt",
    sha256: "72048bf31c327cc05e469dc30362f4c1c7d7d61cd546eceada70b1ba49bd90a3",
    patchedSha256:
      "5815ca17f28f1637a4f9196df263a1d717281cf9dd25b1ad25b4d4c49e23317f",
  },
  androidAudioModule: {
    path: "android/src/main/java/expo/modules/audio/AudioModule.kt",
    sha256: "637fe9bed875e47c3348a1f9623c4e049965efec2ebbe77cff6836c94544177a",
    patchedSha256:
      "bc96dd85aaadd9248c13b9c174fc47b905bbf4078638204bfc565c6551d3a64f",
  },
  androidAudioPlayer: {
    path: "android/src/main/java/expo/modules/audio/AudioPlayer.kt",
    sha256: "636f4ef70dac17d7490ec5e99aa60d71dc7ce6d7b4b913c501001079d6b8f33e",
    patchedSha256:
      "53b5a758e4df527ce10c244174fb3d1103166f2f30b8f958865a7c5b1c4cc1f7",
  },
  androidControlsService: {
    path: "android/src/main/java/expo/modules/audio/service/AudioControlsService.kt",
    sha256: "a39a43672602c9eda1c11b840fbe2984fd57f37dd7be2152d19271131c90fbb7",
    patchedSha256:
      "f819c129b13c6937979f9c2de32a4d908d9876452952718ec7739ced6a20e503",
  },
  iosMediaController: {
    path: "ios/MediaController.swift",
    sha256: "8a1d895f13afe02f291a7db1050c4e74b176963598ced7e83213c3fb7ba3d604",
    patchedSha256:
      "275f31f6a01f9180f607f368eece724473bb9c088312199d98393c3efef88018",
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
    assertContains(
      source,
      [
        "private fun resolveSessionPlayer",
        "activePlayer.requestPlaybackFromSystemControls()",
        "activePlayer.cancelPlaybackFromSystemControls()",
        "override fun play()",
        "override fun pause()",
        "override fun setPlayWhenReady(playWhenReady: Boolean)",
      ],
      "Android controls",
    );
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

  const states = Object.fromEntries(
    Object.entries(sources).map(([key, source]) => {
      const actualSha256 = sha256(source);
      const contract = sourceFiles[key];
      if (actualSha256 === contract.sha256) {
        return [key, "pristine"];
      }
      if (actualSha256 === contract.patchedSha256) {
        return [key, "patched"];
      }
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} ${contract.path} does not match a reviewed pristine or patched source hash; refusing to continue.`,
      );
    }),
  );
  const distinctStates = new Set(Object.values(states));
  if (distinctStates.size !== 1) {
    throw new Error(
      `Expo Audio ${EXPO_AUDIO_VERSION} has a partial Curio Garden backport; reinstall dependencies before retrying.`,
    );
  }

  const patched = applyExpoAudioBackgroundSafety(sources);
  for (const [key, source] of Object.entries(patched)) {
    if (sha256(source) !== sourceFiles[key].patchedSha256) {
      throw new Error(
        `Expo Audio ${EXPO_AUDIO_VERSION} ${sourceFiles[key].path} did not produce the reviewed patched hash; refusing to write any files.`,
      );
    }
  }

  const state = distinctStates.values().next().value;
  if (mode === "apply" && state === "pristine") {
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

  return { changed: state === "pristine", state };
};

module.exports.applyExpoAudioBackgroundSafety = applyExpoAudioBackgroundSafety;
module.exports.patchInstalledExpoAudio = patchInstalledExpoAudio;
module.exports.EXPO_AUDIO_BACKGROUND_SAFETY_MARKER =
  EXPO_AUDIO_BACKGROUND_SAFETY_MARKER;
