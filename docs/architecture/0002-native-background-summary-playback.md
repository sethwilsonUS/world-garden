# ADR 0002: Native background summary playback

- Status: Accepted
- Date: 2026-08-05
- Owners: Curio Garden maintainers

## Context

The native Article already offers user-initiated playback of its complete
summary from a bounded private cache file. Phase 6 requires playback to survive
screen lock and ordinary app backgrounding without weakening the repository's
explicit deferrals for push notifications, recording, downloads, and offline
storage.

Expo Audio 57 supports a single `AudioPlayer` as an operating-system media
session. Its lock-screen surface provides play, pause, scrub, and fixed
forward/backward seek controls. Expo's native `AudioPlaylist` does not expose
that media-session API, and Expo's supplied iOS and Android media sessions do
not expose previous-track or next-track commands. A JavaScript-owned queue also
cannot promise a section transition while iOS has suspended JavaScript.

## Decision

Enable playback-only background capability in generated native projects:

- iOS declares the `audio` background mode;
- Android declares the media-playback foreground service and Expo Audio's
  non-exported media-controls service;
- microphone, recording, push-notification, and offline-storage capabilities
  remain absent. Android blocks `POST_NOTIFICATIONS` and
  `FOREGROUND_SERVICE_MICROPHONE` as defense in depth.

All Expo Audio imports remain inside `ExpoBackgroundAudioRuntime`. Its public
contract accepts one private-file source plus plain metadata and exposes only
play, pause, seek, status snapshot, release, and normalized status events. The
adapter configures `doNotMix`, silent-mode playback, background playback, and
no recording. It keeps the audio session active and registers lock-screen
metadata only on the user-initiated play path, immediately before native
playback. A shared reference-counted coordinator serializes session activation
and deactivation. Native play waits for activation, final-player release waits
for deactivation, and an older release cannot deactivate the session after a
newer player has begun.

The Article route remains the owner for this first vertical slice:

- work that has not created a native player is cancelled when the app reaches
  the background;
- an established playing, paused, or finished player and its disposable file
  lease survive `inactive`, background, and screen lock;
- returning to the foreground reads the native status snapshot and never
  regenerates or automatically resumes audio;
- leaving the Article, changing article or account epoch, unmounting, failing,
  or cancelling still revokes media-session ownership, releases the player,
  awaits final audio-session deactivation, and then deletes the private file.

Android's media-style foreground-service notification is part of active media
playback, not push delivery. The app neither declares nor requests the Android
notification runtime permission, and no push SDK, credential, worker, schema,
or user preference is introduced.

Expo Audio 57.0.3 is temporarily built from source on both platforms with a
mobile-owned safety backport. The backport keeps Expo's Android module as the
single audio-focus owner for app and media-session commands: delayed or denied
focus cannot start ExoPlayer, cancellation abandons an outstanding request when
nothing else is waiting, cancellation also clears interruption-resume intent,
and focus gain starts only players that are still waiting before abandoning a
gain with no remaining play intent. ExoPlayer's independent focus handling
remains disabled so two owners cannot race. On iOS, the backport stores the opaque target returned by each
block-based `MPRemoteCommand` registration and removes those exact targets
before replacement and final release.

The patcher is pinned to exact pristine and patched SHA-256 hashes for five
files in `expo-audio` 57.0.3. It preflights the complete source set before any
write, uses exact transforms and per-file atomic replacement, verifies the
result, and rejects an unknown version, source drift, or mixed state. Local
native scripts and EAS apply it after dependency installation; the aggregate
mobile check verifies the contract. No root or mobile install hook runs it, so
the web workspace and ordinary repository installation remain outside the
native mutation path. Expo autolinking opts only `expo-audio` out of precompiled
native binaries so the reviewed Kotlin and Swift are the code that is compiled.

Play All, section-by-section controls, previous/next commands, automatic
background section transitions, playback-rate UI, progress persistence, and a
global player route remain separate Phase 6 work. Before claiming those queue
features, the project must choose and test a native queue/media-session
strategy rather than simulating reliable background transitions in suspended
JavaScript.

## Consequences

The app needs new iOS and Android binaries; this capability cannot be delivered
as an update to an older binary. Starting summary audio may create an Android
media notification, while merely loading an Article creates no player, media
session, service, sound, or permission prompt.

Building `expo-audio` from source adds native build work. This is preferable to
silently compiling an unpatched prebuilt binary, but it remains temporary. On
every Expo Audio upgrade, inspect upstream Android focus routing and iOS remote
target cleanup. Remove the patcher, source-build opt-out, and contract tests only
when both fixes are released and signed physical-device interruption and
repeated-activation tests pass.

Automated tests can prove generated declarations, adapter ordering, serialized
session ownership and final deactivation, lifecycle ownership, safe status
reconciliation, and architecture isolation. Exact
lock-screen speech, physical interruption behavior, Bluetooth/headphone routes,
notification presentation, and cleanup still require signed-build VoiceOver
and TalkBack runs on named physical hardware.

## References

- [Expo Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
- [Expo modules built from source](https://docs.expo.dev/guides/prebuilt-expo-modules/)
- [Android notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [Android Media3 playback control](https://developer.android.com/media/media3/session/control-playback)
- [Apple background audio configuration](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
