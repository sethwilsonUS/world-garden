# ADR 0003: Native playlist media session foundation

- Status: Accepted
- Date: 2026-08-05
- Owners: Curio Garden maintainers

## Context

Phase 6 needs Play All and section-by-section playback to continue across
ordinary app backgrounding and screen lock. JavaScript cannot reliably advance
the queue after iOS suspends it, so a JavaScript timer or a chain of individual
players cannot satisfy that requirement.

Expo Audio 57.0.3 already supplies native playlist engines: `AVQueuePlayer` on
iOS and Media3 `ExoPlayer` on Android. Its playlist API does not, however,
publish ordered per-track metadata to the operating-system media session or
expose previous/next section commands there.

React Native Track Player was evaluated as an alternative. Its current v5
requires a commercial license, while v4 and earlier remain on an Apache-2.0
legacy branch. Adopting v4 would add a second playback stack and a
separate React Native 0.86/New Architecture compatibility obligation. That is
more platform and upgrade risk than extending the Expo Audio version already
pinned and compiled by the app.

## Decision

Extend the existing exact-version Expo Audio backport with native playlist
media-session support:

- iOS generalizes the existing `MediaController` from one `AudioPlayer` to an
  identity-checked player-or-playlist owner. It publishes metadata for the
  current `AVQueuePlayer` item and registers native previous/next-track
  commands. Releasing or clearing an older player cannot clear a newer owner's
  controls.
- Android keeps the playlist's Media3 `ExoPlayer` inside the existing
  `MediaSessionService`. A player-or-playlist adapter preserves Expo Audio's
  single audio-focus owner, publishes current metadata on native media-item
  transitions, advertises previous/next commands to modern controllers, and
  supplies explicit section actions for older notification surfaces only when
  a previous or next item actually exists.
- Both platforms keep nullable metadata slots aligned with native queue
  mutations. A missing metadata item degrades to an unlabeled track; it cannot
  label a different section by mistake.
- Both native playlist engines expose a nullable string error in each status
  snapshot and clear it only when a new item or ready state supersedes the
  failure, so the visible queue need not confuse a failed load with buffering.
- Both engines expose durable terminal state. Replaying an exhausted queue
  restarts from item zero for app and operating-system controls instead of
  depending on a transient final status event or a depleted native queue.
- Both platforms release only the media session they own and use identity
  checks when unregistering. A stale disconnect, asynchronous session build,
  or older player release cannot replace or clear the active session.

`ExpoBackgroundAudioRuntime.createPlaylist` is the only application boundary
for the capability. It accepts a non-empty, fixed-order array of private
`file:///` sources and plain metadata, then exposes status, track changes,
play, pause, seek, previous, next, skip, and release. It intentionally exposes
none of Expo Audio's queue mutation methods. The adapter registers the complete
metadata array immediately before user-initiated playback and shares the
serialized, reference-counted audio-session coordinator used by single-track
summary playback.

The foundation PR established infrastructure only. Its follow-up visible-controls
slice now consumes that boundary without widening it: a mobile-owned planner
preserves canonical source-array section keys, includes heading transitions in
Play All, and marks genuinely empty headings unavailable. The Article surface
offers user-initiated Play All, individually playable summary/section rows, and
bounded previous/next actions while keeping the current item and consequential
state changes visible and politely announced.

The consumer stages sources sequentially under short-lived cache leases before
constructing the fixed queue. Each response retains the existing 16 MiB
exact-length limit; Play All additionally rejects more than 64 native tracks or
more than 256 MiB of leased audio without disabling individual section playback.
Declared bytes are checked before staging, and staged lease bytes are checked
again before the lease joins the active aggregate.
Native player/session release completes before any leased file is deleted.
Downloads, offline storage, push notifications, automatic playback, playback
speed, persisted progress, and persistent background work remain out of scope.

The patcher now preflights thirteen reviewed Expo Audio source files across
three coherent states: pristine 57.0.3, the previously shipped
background-safety backport, and the final playlist backport. A reviewed unified
patch modifies twelve of those files. Its own SHA-256 is pinned; all source and
result hashes are checked in memory before any atomic replacement. Unknown or
mixed states fail closed. The patch still runs only from native/EAS entry
points, never a root or mobile install hook, so web installation and production
builds remain outside the mutation path.

## Consequences

Background section transitions and operating-system previous/next commands can
now be native and deterministic without introducing another playback library.
The application boundary is fixed-source by design, which keeps metadata
alignment and the visible consumer's temporary-file ownership reviewable.

This remains a temporary fork of Expo Audio 57.0.3. Every Expo upgrade must
re-evaluate upstream playlist media-session support, Android focus routing,
stale-session ownership, and iOS remote-command cleanup. Remove the patch when
equivalent upstream behavior is available and signed physical-device tests
pass.

Automated checks cover exact-version application, pristine and prior-backport
upgrades, mixed-state refusal, session ownership, metadata ordering, native
command declarations, TypeScript lifecycle ordering, canonical queue planning,
individual and Play All controls, preparation/storage bounds, current-item
status, durable terminal replay, account/background cleanup, and Kotlin/Swift
compilation. They cannot
prove lock-screen speech, Bluetooth/headphone behavior, interruption recovery,
notification presentation, exact screen-reader speech, or maximum-text reflow.
Those remain named physical-device VoiceOver and TalkBack gates before the
visible queue feature can be called complete.

## References

- [Expo Audio 57](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
- [Android Media3 playback control](https://developer.android.com/media/media3/session/control-playback)
- [Apple previous-track command](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter/previoustrackcommand)
- [React Native Track Player repository and licensing](https://github.com/doublesymmetry/react-native-track-player)
