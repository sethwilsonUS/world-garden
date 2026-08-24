# Curio Garden mobile

This workspace is the native iOS and Android sidecar for Curio Garden. The
production Next.js application remains at the repository root.

## Foundation commands

Run installation from the repository root so npm uses the single lockfile:

```sh
npm ci
npm run mobile:check
npm run mobile:doctor
```

Static bundle, dependency, Doctor, and aggregate check commands inject a
structurally valid `.invalid` Clerk key only while evaluating test config; it
cannot authenticate and is never a release credential. Running the app still
requires the matching real environment key.

Start Metro for the development client:

```sh
cp mobile/.env.example mobile/.env.local
# Add the same Clerk test publishable key used by the local web app.
npm run mobile:start
```

Generate and run a clean native development project when native configuration
changes:

```sh
npm run mobile:ios
npm run mobile:android
```

The platform folders are Continuous Native Generation output and are ignored.
Do not make durable edits inside `mobile/ios` or `mobile/android`; express them
through `app.config.ts` or a config plugin.

Expo Go may be useful for an occasional JavaScript-only smoke check, but it is
not part of the compatibility throughline. Development-client and signed EAS
builds are the acceptance artifacts.

Fraunces, DM Sans, and JetBrains Mono are embedded with the `expo-font` config
plugin so they are available before the first native frame. A fresh development
or signed build is required after changing that font manifest; Expo Go and an
older installed client are not representative typography checks.

## Current product slice

The current native slice mirrors the web search workbench, adds native article
reading, establishes shared Clerk/Convex account identity, and lets a signed-in
account save and manage its Library. Home accepts a Wikipedia topic, Search
shows public Wikipedia results, and each complete result card is one named link.
Activating a result opens a native Article route with the article title and
provenance, an optional lead thumbnail with visible attribution, the summary,
and section headings with bounded paragraph reading stops. The summary appears
as one visible lead sentence followed by the background-capable article-audio
surface. Play All, individually playable summary/section rows, current-item
status, and bounded previous/next controls mirror the current web hierarchy;
the optional `Show full text summary` disclosure remains ahead of those item
rows. The article also exposes its Wikipedia source and applicable license as
named external links. Public search, reading, and article playback continue to
work while signed out.

Account represents loading, signed-out, connecting, connected, and bridge-error
states without displaying token, issuer, session, or subject identifiers. Both
iOS and Android start Clerk's official hosted flow through
`@clerk/expo` 4.2.1 `useHostedAuth()`, which opens sign-in or account creation in
an operating-system browser authentication session, redeems the callback, and
activates the resulting native session. Browser cookies or account state are
never trusted as proof that the browser and app use the same identity. Clerk
sessions use the secure-store token cache, and the UI treats identity as
connected only after Clerk and the Convex viewer
agree on the exact account.

The signed-in Library reads and mutates the same account-scoped Convex bookmarks
as the web application. Every native bookmark read and write binds the private
expected Clerk/Convex subject and an opaque account epoch at the server
boundary before accessing data; app-owned screens cannot import that transport
binding. An Article exposes an explicit save/remove action, and
Library lists the account's saved articles as separate named article links with
sibling Remove buttons. Removing an entry from that list requires confirmation,
then returns focus to the next saved article, the previous saved article, or the
Library heading when the list becomes empty. Routine query synchronization
preserves focus while its target remains. If synchronization deletes the
tracked input-focused row, the app makes a best-effort move to a surviving row
or the heading; physical VoiceOver and TalkBack cursor behavior remains an
explicit signed-device gate because React Native does not expose that cursor as
a cross-platform focus event.
Changing account epochs clears private entries and operation feedback before the
new account can load, so an Account A result cannot appear for Account B.
Signed-out reading stays public, but there is no guest or device-backed Library.

The current web application remains the visual authority for app-owned native
screens. Hosted Account Portal appearance is managed in the Clerk Dashboard and
must be kept aligned with that design. The app does not link to web export or
permanent-deletion controls yet: an account-bound lifecycle handoff must exist
before native code can safely expose those operations.

The native reader deliberately stops at the content it can represent faithfully.
A richer web handoff explains that galleries, broader context, and citation
details remain available on the canonical
`https://curiogarden.org/article/...` page. Audio starts only after the listener
activates Play All or one playable row and never autoplays. Once established,
the native queue survives ordinary app backgrounding and screen lock, exposes
play/pause/scrub plus previous/next media commands, and reconciles native state
when the app returns without regenerating or automatically resuming audio.
Backgrounding before native playback activation completes cancels that startup,
even if the queue object has already been created. A completed queue exposes a
durable terminal state and restarts from its first item from either app or
operating-system controls.
Leaving the Article or changing article or account still releases it. Final
release serializes native audio-session deactivation before deleting every
staged file; an older player's deactivation cannot race behind and silence a
newer player. Playback speed, persisted progress/resume, a global Player route,
personal Playlist management, downloads, offline article or audio storage, and
push notifications are not part of this slice.

Web and native share the article-route codec in `@curio-garden/domain`. It
normalizes titles to NFC, uses underscores for word separators, and encodes a
slug exactly once. Each build registers its environment-specific app scheme,
and the native route adapter accepts canonical article paths for all four
schemes. Unsupported, malformed, credentialed, queried, or fragmented incoming
locations fall back to Home instead of being guessed or forwarded.

The same adapter recognizes the canonical production HTTPS form so the path is
ready for future Universal Links and Android App Links. Those OS associations
are not configured in this slice: opening a `https://curiogarden.org` article
continues to use the web application, including from the native reader's richer
web handoff.

Search terms are normalized without rewriting the user's words. The visible
search label remains present, the input and Search button remain separate
controls, and each result's ordinal, title, and optional description form the
accessible name of one link. Search, Article, and Library each keep one
persistent route heading and one persistent status node through loading, error,
and retry states; async changes announce useful status without stealing focus.
The Article Library action uses visible saved/in-progress wording plus matching
selected, busy, and disabled accessibility state. The native control remains
focusable while busy and ignores repeat activation so a state update does not
strand screen-reader focus.
Article paragraphs remain
complete, separate screen-reader stops beneath real section headings. External
article, license, and attribution targets are sanitized HTTPS URLs and expose
the link role. A missing or failed thumbnail leaves visible explanatory copy
and attribution rather than a blank graphic. Cache retrieval metadata such as
`lastFetchedAt` may be described as fetched or retrieved, but never as
`Last edited`, because it is not Wikipedia revision history.

The exact screen-reader speech, destination-heading and post-removal focus,
long-article reading order, image fallback behavior, same-account Library sync,
account-switch isolation, and back focus still require the signed
physical-device runs recorded in the
[native accessibility test matrix](../docs/mobile-accessibility-test-matrix.md).

## Local Android SDK

Expo and React Native honor `ANDROID_HOME`. When Android Studio does not add its
tools to the shell, set it to the local SDK and add `platform-tools` and
`emulator` to `PATH`. The project targets API 36 and supports API 24 or newer.

## Build profiles

Run EAS commands from this directory. Profiles are `development`, `preview`,
`e2e-test`, and `production`; each sets `APP_VARIANT` so its display name,
identifier, and URL scheme cannot silently cross environments.

```sh
cd mobile
npx --yes eas-cli@21.5.0 build --profile development --platform ios
npx --yes eas-cli@21.5.0 build --profile development --platform android
```

The documented EAS CLI command and the Doctor script use explicit tool
versions compatible with `eas.json`. EAS owns production build-number
increments remotely, so repeated TestFlight and Play uploads do not reuse an
already-published native build number.

`development` and `e2e-test` both select the Development EAS environment and
default to the reviewed public development deployment at
`https://standing-finch-735.convex.cloud`. That value is not a preview or
production fallback. Preview and production configuration must set
`EXPO_PUBLIC_CONVEX_URL` explicitly in the corresponding EAS environment, and
both reject the reviewed development deployment. The build configuration and
the embedded runtime metadata validate the value as an origin-only HTTPS
`*.convex.cloud` URL; only a development build may opt into a loopback HTTP
origin. Missing or invalid preview/production configuration fails closed during
configuration or startup.

`EXPO_PUBLIC_CONVEX_URL` is bundled public client configuration, not a secret.
Do not put credentials, paths, query parameters, or fragments in it.

Every native profile also requires `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in its
selected EAS environment. The Development and Preview EAS environments must
contain a `pk_test_` key; `e2e-test` deliberately consumes the Development EAS
environment and therefore uses the same development test instance and backend.
The Production EAS environment must contain a `pk_live_` key. The build and
embedded runtime both validate the full Clerk key structure and reject test/live
crossovers. Clerk publishable keys are bundled client configuration, but real
values still stay in local or EAS environment configuration rather than source
control; Clerk secret keys must never use an `EXPO_PUBLIC_` name.

For local development, copy `mobile/.env.example` to `mobile/.env.local` and
set the same test-instance publishable key used by the local web application.
Expo treats `mobile/` as the project root and does not automatically load the
repository-root `.env.local`.

Hosted Clerk authentication also requires the compatible
`expo-auth-session`, `expo-crypto`, and `expo-web-browser` peer packages. The
Clerk config plugin registers the default callback locations:
`<bundleIdentifier>://callback` on iOS and
`clerk://<package>.hosted-callback` on Android. Each signed bundle identifier
and package name must be registered as a Native Application in the matching
Clerk instance, and Native API access must be enabled, before a release build
can complete the callback.

Hosted Google sign-in uses Clerk's web OAuth flow and therefore does not require
native iOS or Android Google client IDs. It still requires a correctly
configured Google provider in the Clerk Dashboard and signed-build acceptance;
an enabled Dashboard button alone is not evidence that the flow works. The
Clerk plugin's Apple Sign In entitlement is explicitly disabled until the
corresponding signed-build product gate passes.

Native Clerk 4 requires iOS 17 or newer. The explicit `17.0` deployment target
in `app.config.ts` keeps Expo's build-properties plugin aligned with Clerk's
config plugin instead of letting plugin order produce a client that builds but
cannot install or start on its declared iOS floor.

Push notifications are intentionally disabled and not installed. The
`expo-audio` config enables background playback while explicitly disabling
background recording and microphone access; Android additionally blocks
`RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE`, and `POST_NOTIFICATIONS`.
Android's playback-only foreground service and media notification are activated
only for a user-started media session and are not push-notification delivery.
Article playback stages exact-length MP3 responses in the app cache only for
the lifetime of active player leases, including ordinary background playback.
One file remains capped at 16 MiB; Play All rejects more than 64 queue items or
more than 256 MiB of leased audio while leaving individual section controls
available. The aggregate is checked against declared response bytes before
staging and against actual staged lease bytes before retention. Controlled
release first deactivates the final shared audio-session
owner and then deletes every file; activation/deactivation transitions are
serialized so a stale release cannot overtake a new play. The shared store
scavenges stale entries once per cold JavaScript runtime without disturbing
another route's still-releasing lease. This is a disposable native handoff, not
a download or offline mode. Offline article or audio storage, guest/device
Library persistence, and persisted playback progress remain outside the current
implementation scope.

### Pinned Expo Audio background-safety backport

The installed `expo-audio` 57.0.4 native source has two background-control
defects that this slice cannot safely ship around at the JavaScript boundary:

- Android media-session play commands can call ExoPlayer directly and bypass
  Expo Audio's module-owned audio-focus request. Curio Garden routes both UI and
  system play/pause commands through one focus state machine, including delayed,
  denied, cancelled, gained, and released focus. Cancellation clears both
  delayed-play and interruption-resume intent, and a late gain with no remaining
  play intent is immediately abandoned.
- iOS block-based `MPRemoteCommand` registrations return opaque target tokens.
  Expo Audio 57.0.4 discards those tokens and therefore cannot remove the
  handlers it registered. Curio Garden retains and removes every exact token so
  repeated player activation does not accumulate duplicate commands.

`scripts/expo-audio-background-safety.js` is a mobile-owned, fail-closed source
backport for exactly `expo-audio` 57.0.4. It preflights thirteen reviewed source
files across coherent pristine, prior background-only, and final playlist
states before writing any file. Exact one-occurrence background transforms feed
a SHA-256-pinned unified patch that modifies twelve files; every final source
hash is checked in memory, then every replacement and backup is staged and
verified before any rename. A failed replacement restores every already-renamed
source before the build exits; if that rollback is itself incomplete, the build
reports every failure and preserves the named backup files as manual-recovery
artifacts. All final files are verified again afterward. An unknown version,
changed source, mixed state, or altered patch stops the build for review.

The mobile workspace opts only `expo-audio` out of Expo's precompiled native
modules on iOS and Android. `preios`, `preandroid`, and EAS's
`eas-build-post-install` hook apply the backport before a native build;
`npm run mobile:check` verifies the pinned contract. There is deliberately no
repository-root or mobile `postinstall`, so ordinary dependency installation
and the production web build do not mutate native packages or inherit this
workaround.

Use the mobile workspace's `npm run ios` and `npm run android` entry points for
local native builds. Direct `npx expo run:ios`, `npx expo run:android`, and
`npx expo prebuild` invocations bypass `preios`/`preandroid`; run
`npm run native:patch:apply` first and `npm run native:patch:check` afterward if
a direct Expo command is required.

When upgrading `expo-audio`, first verify in upstream native source that every
Android UI and media-session play path requests focus through one owner, native
playlists publish aligned per-track metadata and errors with previous/next
commands, stale sessions cannot replace or clear a newer owner, and iOS stores
and removes the exact `MPRemoteCommand` tokens. Remove or update the backport,
its source-build opt-out, and its tests only after all four upstream conditions
are present and the signed physical interruption/repeated-command matrix passes.

## Accessibility verification

Native accessibility changes follow the
[physical-device test matrix](../docs/mobile-accessibility-test-matrix.md).
VoiceOver, TalkBack, maximum text and display sizes, orientation, appearance,
and reduced-motion results must be recorded against named hardware and a signed
build. Expo Go, Simulator, emulators, Jest, bundle checks, and accessibility
tree inspection are supplementary evidence only.

The automated mobile suites cover app-owned roles, names, unclamped task text,
target geometry, safe error copy, stale-request handling, platform-specific
status wiring, route-heading focus requests, the Article reading contract,
Library save/remove state and modeled post-removal input-focus recovery, account-epoch
isolation, and hosted-auth cancellation, completion, error, and
focus-restoration behavior. They also cover the summary lead/player/disclosure
order, user-initiated background playback, stable control and disclosure state,
bounded ephemeral staging and cleanup, preparation cancellation, established
player retention, foreground status reconciliation without auto-resume, and
generated native permission/background-service configuration. They also cover
reference-counted audio-session ownership, final deactivation before cache
deletion, and the old-release/new-play transition race.
Run `npm run mobile:check` for the current test, type, configuration, and
architecture result instead of relying on a recorded suite count. No automated
suite proves exact spoken output, actual screen-reader focus landing, browser
authentication accessibility, back-focus restoration across the browser
boundary, physical audio-session behavior, lock-screen control speech, touch
exploration, or visual reflow at 200% and the operating systems' maximum text
and display settings. Record those signed-build results in the matrix rather
than carrying an older simulator or emulator result forward.

Reusable screens and controls follow the documented
[native accessibility conventions](../docs/native-accessibility-conventions.md),
including uncapped task text, 48-by-48 minimum targets, visible keyboard focus,
word-safe brand reflow, reduced-motion handling, and platform-appropriate status
announcements.

## Dependency note

`npm audit --omit=dev` currently reports
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), a
moderate buffer-bounds advisory in UUID v3/v5/v6 calls supplied with an output
buffer, through two paths. Expo SDK 57's native configuration chain brings
`xcode@3.0.1 -> uuid@7.0.3`; that build-time path does not ship in application
JavaScript. Separately, the production Clerk graph brings
`@clerk/clerk-js -> @solana/web3.js -> jayson@4.3.0 -> uuid@8.3.2`, and that
code is present in the Hermes bundle. The installed Jayson sources import only
UUID v4 and invoke it without an output buffer, so the reviewed runtime caller
does not reach the advisory's affected APIs. This is a reachability assessment,
not a claim that the vulnerable package is absent. Keep both paths visible until
upstream packages update; do not force an incompatible Expo or Clerk resolution
merely to silence audit output.

The React 19.2.8 compatibility decision and required validation gates are
recorded in the [native sidecar ADR](../docs/architecture/0001-expo-native-sidecar.md).
The first single-summary media-session slice is recorded in the
[background summary playback ADR](../docs/architecture/0002-native-background-summary-playback.md),
and the fixed native queue plus visible consumer are recorded in the
[playlist media-session ADR](../docs/architecture/0003-native-playlist-media-session.md).
