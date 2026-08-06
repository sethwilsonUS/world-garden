# Native accessibility test matrix

Accessibility is release behavior for Curio Garden, not a screenshot review.
Automated tests, Simulator accessibility trees, and emulator screen readers are
useful early evidence, but they do not replace a pass on named physical iOS and
Android hardware.

## Status vocabulary

- **Pass** — the stated scenario was completed in the stated environment with
  no blocking defect.
- **Fail** — a defect prevented or materially degraded the scenario.
- **Blocked** — an external prerequisite such as hardware, signing, or an OS
  service is unavailable. Record the prerequisite and owner.
- **Not run** — the scenario has not been attempted yet.
  Rows marked **supplementary** can pass without satisfying the physical-device
  release gate. Apple does not provide iOS VoiceOver in Simulator, so an
  accessibility-tree inspection must never be described as a VoiceOver pass.

## Home, Search, and web-handoff contract — PR4A

The current native slice must preserve this task and reading-order contract:

- Home exposes `Curio Garden` as its primary heading, followed by the current
  web-aligned introduction and search workbench.
  `Find a topic. Follow the thread.` is a real section heading, not a second
  copy of the brand heading.
- The visible `Search topic` label matches the editable field's accessible
  name. The field and `Search` button are separate controls, and submitting
  empty text exposes `Enter a topic to search Wikipedia.` as a visible alert.
- Entering Search through a user action focuses its primary `Search Wikipedia`
  or `Results for “topic”` heading once. Submitting a different refinement
  establishes a new results-heading context and focuses it once; retrying the
  same term or receiving async results must not steal focus.
- A nonempty search keeps one status node. It changes from
  `Searching Wikipedia for topic.` to the empty, singular, or plural result
  count. A request failure clears obsolete status copy, exposes the safe
  visible error, and leaves `Try again` available.
- Each result is one link focus stop named from its ordinal, title, and optional
  description. Its visual descendants do not create duplicate stops. Opening a
  result focuses the article-title heading on the temporary handoff screen.
- The handoff states that native reading is not present yet. It offers
  `Open article on Curio Garden web` and opens only the exactly-once encoded
  canonical Curio Garden URL; a browser-launch failure remains a visible alert.
- An environment-specific app-scheme article link reaches the same handoff.
  Malformed, unsupported, queried, fragmented, or untrusted incoming locations
  fall back to Home. The route adapter also recognizes the canonical HTTPS form
  for future Universal Links and Android App Links, but this slice does not
  register those OS associations; production HTTPS articles remain on web.

Forward and reverse navigation must remain predictable. There must be no blank,
duplicate, nested, or unlabeled controls. At 200% text size and at each
platform's maximum text and display-size combinations, every field, status,
alert, result title, result description, and handoff action must reflow without
clipping, overlap, truncation, or two-dimensional scrolling. Portrait and
landscape, light and dark appearance, and safe-area clearance are separate
checks.

## Native read-only Article contract — PR4B

PR4B replaces the temporary result handoff with a native read-only Article
route while preserving the PR4A Home and Search contract. It does not carry any
PR4A evidence forward. The Article route must satisfy this additional contract:

- The route owns one persistent primary heading and one persistent status node.
  Their native identities remain stable through loading, success, request
  failure, and retry. Route entry may focus the heading once; async completion,
  failure, image loading, and a same-route retry must not steal focus.
- Loading has useful visible status. A request failure exposes concise visible
  error copy and an operable `Try again` action without leaking backend details
  or creating duplicate status/alert announcements.
- Successful reading order is the article title and provenance, optional lead
  thumbnail and its visible attribution, summary, real section headings and
  complete paragraph stops, source and license links, then the explanation and
  link for the richer web article. Optional content may be absent without
  leaving a blank, duplicate, or unlabeled accessibility stop.
- Each ordinary paragraph is one bounded screen-reader stop beneath its source
  section heading. An exceptionally long source paragraph may split losslessly
  at safe text boundaries into multiple bounded stops. No prose is clamped,
  truncated, ellipsized, collapsed with the whole article into one oversized
  stop, or fragmented into arbitrary sentence stops.
- An available lead thumbnail has a concise image name tied to the article.
  Creator, source, and license attribution stays visible and independently
  readable. If the thumbnail is missing, unsafe, or fails to load, no broken or
  empty graphic remains in the accessibility tree, visible fallback copy is
  present, and any valid required attribution remains available.
- Article source, license, media-attribution, and richer-web actions are named
  links. Only sanitized, complete `https` URLs may be opened. Missing,
  malformed, credentialed, or non-HTTPS targets remain noninteractive or expose
  an unavailable state; an operating-system launch failure remains visible and
  retryable.
- Cache retrieval time is not editorial history. A value derived from
  `lastFetchedAt` may be presented as fetched or retrieved, or omitted, but
  never labeled `Last edited`.
- The web handoff explains that galleries, broader context, and citation detail
  remain richer on the canonical Curio Garden web article. It must not suggest
  that native audio, authentication, library management, offline storage, or
  push notifications exist in this slice.

At 200% text size and each platform's maximum text and display settings, the
complete Article remains one-dimensionally scrollable. Title, provenance,
attribution, summary, every supported heading and paragraph, errors, retry, and
external-link copy must reflow without clipping, overlap, truncation, or
horizontal scrolling. Portrait and landscape, light and dark appearance, safe
areas, bold/high-contrast settings, and image success/failure are separate
checks.

## Historical foundation interaction contract

The following five-item contract applies only to the historical foundation and
themed-shell evidence below. It is retained so those dated results are not
mistaken for current Home/Search validation.

For the foundation screen, assistive technology must expose this order:

1. `Curio Garden`, heading
2. `Explore any Wikipedia article as clear, section-by-section audio, then keep
listening wherever curiosity takes you.`
3. `Native foundation`
4. `Development client foundation ready.`
5. `Expo Go is optional; signed native builds are the release gate.`

There must be no duplicate, blank, or unlabeled elements. Forward and reverse
navigation must be predictable, all content must remain reachable, and the
heading must still be exposed as the single screen heading when it wraps.

At the largest text and display settings, content must reflow without clipping,
overlap, truncation, or two-dimensional scrolling. Portrait and landscape,
light and dark appearance, and safe-area clearance are separate checks.

## Foundation evidence — 2026-08-04

These historical runs establish the pre-theme development baseline. They do
not validate the later bundled-font shell and do not satisfy the future
physical-device beta gate.

| Gate                                           | Environment and build                                                                          | Settings                                                                               | Result  | Evidence                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary iOS semantics and reflow         | iPhone 17 Pro Simulator, iOS 26.5, local Release configuration with embedded JavaScript bundle | `accessibility-extra-extra-extra-large`; light and dark; portrait and landscape        | Fail    | The accessibility tree contained the five contract items in order and one heading, but visual review found the title split as `Curio` / `Gard` / `en` at the largest setting. Mid-word reflow is a blocking defect even though the spoken name remained intact.              |
| Supplementary Android screen reader and reflow | Pixel Android Virtual Device, Android 16/API 36, locally signed Release APK, TalkBack 16.0     | Font scale 2.0; light portrait and landscape                                           | Pass    | TalkBack focus advanced through all five contract items, stopped cleanly after the final item, and reversed from the final item to the card title. The landscape layout exposed the complete card without clipping. No development-client control entered the reading order. |
| Physical iOS VoiceOver                         | No trusted iPhone attached and no device registered with EAS                                   | Largest Larger Accessibility Size; portrait/landscape; light/dark                      | Blocked | Register and connect a supported iPhone, install a signed preview build, then complete the physical script below. VoiceOver is not available in Simulator.                                                                                                                   |
| Physical Android TalkBack                      | No physical Android device attached                                                            | Maximum font and display sizes separately and together; portrait/landscape; light/dark | Not run | Install the signed preview APK on named hardware, then complete the physical script below.                                                                                                                                                                                   |

The iOS Release build also proves the Expo/Xcode throughline against matching
Xcode 26.6 and iOS 26.5 Simulator runtimes. The Android Release APK launches
from its embedded bundle without Metro or Expo development UI.

The current shell must repeat the supplementary checks after Fraunces, DM Sans,
JetBrains Mono, word-safe brand reflow, and system accessibility-preference
handling are present in a signed build. Record that evidence in a new dated
section; do not carry the historical result forward.

## Themed native shell evidence — 2026-08-05

These runs exercise the bundled-font shell introduced after the historical
foundation baseline. They are supplementary emulator/Simulator evidence; the
physical-device release gate remains open.

| Gate                                      | Environment and build                                                                                        | Settings                                                                                                    | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary iOS semantics and reflow    | iPhone 17 Pro Simulator, iOS 26.5, final local Release configuration with embedded JavaScript bundle         | `accessibility-extra-extra-extra-large`; light and dark; portrait and landscape; Increase Contrast          | Pass    | After Metro was stopped, a direct cold launch rendered the embedded bundle and all eight bundled font files. The single accessible `Curio Garden` heading rendered as `Curio` / `Garden` in narrow portrait and as whole words in landscape, never as `Gard` / `en`. Uncapped task copy and the complete release-gate card remained reachable by one-dimensional scrolling with bottom safe-area clearance. Increase Contrast changed the secondary-text and boundary palette live. VoiceOver was not claimed. |
| Supplementary Android TalkBack and reflow | Pixel Android Virtual Device, Android 16/API 36, final locally signed Release APK, TalkBack 16.0.0.738667889 | Font scale 2.0 and density 560 together; light and dark; portrait and landscape; High Text Contrast enabled | Pass    | TalkBack hardware-keyboard navigation traversed the five contract items forward and backward, exposed one `Curio Garden` heading focus stop, auto-scrolled the final copy fully into view, and stayed on the final app item when advanced again. Maximum-scale content remained one-dimensionally scrollable in both orientations. Direct cold launch used the embedded bundle. The release APK requested no storage, notification, or draw-over-other-apps permission.                                        |
| Physical iOS VoiceOver                    | No trusted iPhone attached and no device registered with EAS                                                 | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast          | Blocked | Register and connect a supported iPhone, install the signed preview build, and complete the physical script below. Simulator has no VoiceOver and cannot satisfy this gate.                                                                                                                                                                                                                                                                                                                                    |
| Physical Android TalkBack                 | No physical Android device attached                                                                          | Maximum font and display sizes together; portrait/landscape; light/dark; High Text Contrast                 | Not run | Install the signed preview APK on named hardware and complete the physical script below.                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Home/Search slice evidence — 2026-08-05

These rows cover the current PR4A task contract. Historical shell evidence does
not carry forward. Automated and emulator rows are useful regression evidence,
but they do not satisfy either physical-device screen-reader gate.

| Gate                                                | Environment and build                                                                                  | Settings                                                                                           | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary automated semantics and interaction   | Local Jest suites with React Native platform APIs mocked                                               | Both iOS and Android status branches; no rendered OS text size                                     | Pass    | The Home, Search, route-heading, form, result-link, handoff, and status suites verify visible labels and alerts, roles and names, one-stop result semantics, 48-by-48 minimum targets, unclamped result and input text, normalized submission, a persistent status node, stale-request rejection, safe retry behavior, canonical web handoff, one focus request per new route context, and no refocus on async completion. This does not prove speech, focus landing, back-focus restoration, or layout.                                                                                                                                                               |
| Supplementary iOS partial current-slice reflow      | iPhone 17 Pro Simulator, iOS 26.5, local Release configuration with an embedded JavaScript bundle      | `accessibility-extra-extra-extra-large`; light portrait                                            | Pass    | With Metro unavailable, cold Home and an encoded `AC%2FDC` article link launched from the embedded bundle. `Curio Garden` rendered as two whole words, the handoff scrolled one-dimensionally, and the encoded-slash title broke only at its slash. The full Home → Search → result task, landscape, dark appearance, and VoiceOver remain untested in this row; Simulator cannot provide VoiceOver.                                                                                                                                                                                                                                                                   |
| Supplementary Android current-slice TalkBack/reflow | Pixel Android Virtual Device, Android 16/API 36, locally signed Release APK, TalkBack 16.0.0.738667889 | Font scale 2.0 and density 560 together; light portrait and dark landscape                         | Pass    | The embedded release bundle cold-launched without Metro. TalkBack keyboard traversal moved from the Search heading to the persistent result status and then one complete result-card stop; activating the result reached the article heading. The full handoff action remained reachable by one-dimensional focus scrolling. A cold encoded-slash link focused `AC/DC` after Android startup focus settled, and its Back action fell back to the empty Search route. In dark landscape, sequential focus scrolling fully exposed the input, Search button, and empty-state card without horizontal scrolling. Exact speech and physical touch exploration remain open. |
| Physical iOS VoiceOver                              | No trusted iPhone attached and no device registered with EAS                                           | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast | Blocked | Register and connect a supported iPhone, install a signed preview build, and complete the current physical script below. VoiceOver is unavailable in Simulator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Physical Android TalkBack                           | No physical Android device attached                                                                    | Maximum font and display sizes together; portrait/landscape; light/dark; High Text Contrast        | Not run | Install the signed preview APK on named hardware and complete the current physical script below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Native Article slice evidence — 2026-08-05

These rows belong only to PR4B's read-only native Article contract. PR4A's
automated, Simulator, and emulator results above remain historical evidence and
do not validate Article loading, long-form reading, media, external links, or
failure recovery.

| Gate                                                   | Environment and build                                                                                 | Settings                                                                                                   | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary automated Article state and semantics    | `npm run mobile:check`; PR4B working tree                                                             | Mocked native status/focus APIs; no rendered OS text or screen-reader speech                               | Pass    | All 27 mobile suites and 227 tests pass. ArticleScreen and ArticleDocument cover persistent heading/status identity through error, timeout, retry, and success; exact decoded-slug retrieval; stale and unmounted requests; safe errors; semantic heading order; bounded lossless paragraph stops; empty content; and mocked no-focus-theft behavior.    |
| Supplementary automated media and external-link safety | Focused ArticleDocument, GardenLink, and ArticleScreen Jest suites                                    | Safe, absent, malformed, non-HTTPS, credentialed, stale-launch, launch-failure, and image-failure fixtures | Pass    | Tests prove named image semantics, visible attribution, absent/unsafe/failed-image fallback, HTTPS-only source/license/attribution/web targets, exact canonical encoding, 48-point link targets, unmounted and last-action-wins launch handling, visible safe launch errors, and omission of cache-derived editorial-history claims.                     |
| Supplementary iOS Article cold-link and reflow         | iPhone 17 Pro Simulator, iOS 26.5, local Release with embedded Hermes bundle; Metro unavailable       | `accessibility-extra-extra-extra-large`; light and dark portrait                                           | Pass    | A cold encoded-slash link opened native `AC/DC` and reported 19 readable sections. The Home brand remained exactly `Curio` / `Garden`, and the title broke only at `/`; no top-region clipping was visible. Simulator VoiceOver, landscape, bottom-region traversal, Bold Text, and Increase Contrast remain open.                                       |
| Supplementary Android Article TalkBack and reflow      | Pixel Android Virtual Device, Android 16/API 36, locally signed Release APK; TalkBack enabled         | Font scale 2.0 and density 560 together; light portrait and dark landscape                                 | Pass    | A cold encoded-slash link opened native `AC/DC`. The accessibility tree retained one heading and one status node from Loading to Loaded 19 sections; TalkBack hardware traversal reached attribution, exact-revision, license, and richer-web links. Failed live thumbnails showed the visible fallback. Physical touch and spoken phrasing remain open. |
| Signed iOS VoiceOver, Article reading and reflow       | No trusted physical iPhone attached; the supplementary Simulator row above does not satisfy this gate | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast         | Blocked | Register and connect a supported iPhone, install the signed PR4B preview build, then complete the Article additions to the physical script below. VoiceOver is unavailable in Simulator.                                                                                                                                                                 |
| Signed Android TalkBack, Article reading and reflow    | No physical Android device attached; the supplementary emulator row above does not satisfy this gate  | Maximum font and display sizes separately and together; portrait/landscape; light/dark; High Text Contrast | Not run | Install the signed PR4B preview APK on named hardware and complete the Article additions to the physical script below.                                                                                                                                                                                                                                   |

## Native Account and identity contract — PR5A

This slice adds identity without making public reading contingent on a session:

- Home exposes `Account` as a separate 48-point button after the public search
  task. Search and Article remain usable while signed out or while the account
  bridge is recovering.
- Account has one route heading and one persistent visible status. Loading,
  guest, connecting, connected, bridge-error, signing-out, and safe failure
  states remain distinguishable without color or timing alone.
- `Sign in` starts one Clerk Account Portal flow through `@clerk/expo` 4.2.1's
  `useHostedAuth()`. The operating system presents the hosted authentication
  session, with an Android Custom Tab on Android. While it is active, background
  Account status is excluded from accessibility announcements. Cancel, failure,
  and success return focus to a logical destination once.
- A connected account exposes only normalized display name and email. Clerk
  subjects are retained only inside the identity layer for exact Convex
  correlation. Clerk user IDs, Convex subjects, issuers, session IDs, tokens,
  and upstream error details are neither visible nor announced.
- Sign-out removes private profile details before the request completes,
  exposes an announced busy state, rejects duplicate activation, and turns a
  failure into concise retryable copy. Account switches never restore the prior
  account's profile or stale operation result.
- No build exposes an export, deletion, or ordinary-web account-management
  link. A browser may hold a different Clerk session from the native app, so a
  lifecycle handoff could operate on the wrong account. An account-bound native
  lifecycle flow remains a release gate.
- The hosted SDK flow must reject an untrusted return: callback location and
  state, PKCE redemption, rotating-token nonce, and created session are all
  validated before activation. Every method displayed in the Account Portal
  must complete in a signed build. Google is dashboard-enabled and the hosted
  path does not require native Google client IDs, but it has no signed-device
  acceptance yet.

| Gate                                                      | Environment and build                                                                               | Settings                                                                                                     | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary automated Account semantics and isolation   | Local Jest, TypeScript, ESLint, and `ts-archunit`; PR5A working tree                                | Mocked Clerk, Convex, hosted-auth-session, accessibility, and focus APIs; no portal or spoken output         | Pass    | All 33 mobile suites and 329 tests passed. Coverage exercises explicit identity states, exact safe viewer projection and Clerk/Convex subject agreement, private-query failure containment with public reading preserved, opaque session epochs that remain stable without relying on React memo caches, stale account switches, deduplicated sign-out with suppression cleanup and post-commit focus handoff, secure provider composition, hosted-flow start/cancel/success/error handling, explicit preparation and error announcements, background-status suppression, progress/error status precedence, a stable enabled and focusable opener throughout hosted auth, renderer-aware focus events after return, controlled status reveal after focus, exact callback preservation, 48-point app controls, safe visible failures, and architecture boundaries. These tests do not prove Account Portal rendering, speech, or real focus landing. |
| Supplementary iOS Release smoke and app-owned reflow      | iPhone 17 Pro Simulator, iOS 26.5, unsigned local Release with final embedded Hermes bundle         | Medium and `accessibility-extra-extra-extra-large`; light portrait                                           | Pass    | The final Release app built with simulator code signing disabled, embedded 1,365 modules, installed, and cold-launched. A CLI XCTest passed with whole-word `Curio` / `Garden` branding and an `Account & data` heading that wrapped only between words. A fresh three-minute log scan found no secret-shaped output, crash, fatal, uncaught exception, or fault. This is not a signed-device, hosted-auth, or VoiceOver pass; Simulator cannot provide VoiceOver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Historical iOS native `AuthView` acceptance               | iPhone 17 Pro Simulator, iOS 26.5, retired local Release integration                                | `accessibility-extra-extra-extra-large`; light portrait                                                      | Fail    | The active email field exposed an empty accessible label, the Back target was undersized, and footer content overlapped at the largest text setting. The native view was rejected and is being replaced on both platforms; this row is historical defect evidence and cannot validate the hosted flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Supplementary iOS hosted Account Portal flow              | Hosted replacement not yet accepted in a signed iOS build                                           | Medium and largest text; portrait/landscape; light/dark; Bold Text and Increase Contrast                     | Not run | Exercise launch, email and Google completion, cancellation, safe failure, callback return, background-status suppression, and focus restoration. Accessibility-tree inspection remains supplementary, and physical VoiceOver remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Supplementary Android app-owned Home/Account reflow       | Pixel Android Virtual Device, Android 16/API 36, final locally signed Release APK                   | Font scale 2.0 and density 560 together; light portrait                                                      | Pass    | App-owned Home and Account content reflowed without clipping: the brand stayed whole-word `Curio` / `Garden`, `Account & data` wrapped only between words, and Search, Account, and Sign in remained reachable. This row does not carry forward to exact TalkBack speech, physical touch exploration, or a physical-device gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Historical Android native `AuthView` acceptance           | Pixel Android Virtual Device, Android 16/API 36, retired local Release integration                  | Font scale 2.0; light portrait                                                                               | Fail    | `Continue with Google` wrapped inside Clerk's fixed-height 48 dp social button and clipped. The native view was rejected and is being replaced on both platforms; this row is historical defect evidence and cannot validate the hosted flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Supplementary Android hosted cancellation instrumentation | Pixel Android Virtual Device, Android 16/API 36, final locally signed Release APK; TalkBack enabled | Normal font and display size for the auth lifecycle; combined maximum settings separately checked for reflow | Pass    | The exact hosted callback resolved only to the app activity and Sign in opened Clerk in a Chrome Custom Tab. TalkBack announced `Opening secure sign-in.` Before the fix, the busy opener was native-disabled and Back retained focus. In the final APK, the same opener remained enabled, received the renderer-aware focus event 996 ms after system-Back cancellation, and no later focus event stole it through status reveal. Attaching the diagnostic observer itself clears TalkBack's current node, so observer-free focus ownership and physical speech remain explicit manual-device gates rather than claims in this row.                                                                                                                                                                                                                                                                                                                |
| Supplementary Android hosted Account Portal flow          | Hosted replacement not yet accepted in a signed Android build                                       | Maximum font and display sizes separately and together; portrait/landscape; light/dark; High Text Contrast   | Not run | Exercise Custom Tab launch, email and Google completion, system Back cancellation, safe failure, callback return, background-status suppression, focus restoration, and TalkBack traversal. Emulator evidence remains supplementary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Signed iOS VoiceOver, Account and hosted Clerk flow       | No trusted physical iPhone attached                                                                 | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast           | Blocked | Register and connect a supported iPhone, install a signed build, and complete the PR5A additions below. VoiceOver is unavailable in Simulator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Signed Android TalkBack, Account and hosted Clerk flow    | No physical Android device attached                                                                 | Maximum font and display sizes separately and together; portrait/landscape; light/dark; High Text Contrast   | Not run | Install the signed build on named hardware and complete the PR5A additions below. Emulator results remain supplementary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Native Library and save contract — PR5B

This slice adds signed-in Library management while public Search and Article
reading remain available without an account. The current web application is the
visual and copy authority. Native layout may adapt to the platform, but it must
preserve this account and accessibility contract:

- Home exposes Library without merging, hiding, or reordering the public Search
  controls. Signed-out Library has one heading and one status, explains that
  saved articles require an account, and keeps public exploration available.
- A signed-in Article exposes visible `Save to Library` or `Saved to Library`
  wording. Its accessible name includes the article title and save/remove
  purpose; selected, busy, and disabled state match the visible state. The same
  native control remains focusable while busy and ignores repeat activation. A
  pending or failed request never relies on color or exposes backend details.
- Library reads and mutates the same account-scoped Convex bookmarks as web.
  The native server contract binds every list and write to the authenticated
  subject expected by the private transport layer as well as the current
  account epoch. Same-account web and native changes synchronize, but there is
  no guest/device persistence, download, offline article storage, audio,
  playlist playback, or push behavior in this slice.
- Library owns one persistent primary heading and one persistent status node
  across signed-out, connecting, loading, error, empty, list, mutation, and
  retry states. Routine synchronization does not refocus a target that remains
  present. Modeled input focus recovers to a surviving row or the heading when
  its row disappears; React Native does not expose a reliable cross-platform
  VoiceOver/TalkBack cursor-focus callback, so physical assistive-technology
  recovery remains an open acceptance gate.
- Each saved article is one named link with its saved date. Its named Remove
  button is a sibling, not a nested control. Both targets remain at least 48 by
  48, expose visible focus, activate on release, and keep their text unclamped.
- Removing an entry from the Library list requires confirmation. Cancel and
  failure preserve a sensible focus path. After a committed removal, focus
  moves to the next saved article, then the previous article if there is no next
  entry, or the Library heading when the final entry is removed.
- Every private query, mutation, busy state, error, status, and deferred focus
  operation is scoped to the validated account epoch. Signing out or switching
  from Account A to Account B clears Account A's entries and operation feedback
  before Account B can load; stale completion is ignored.

| Gate                                                  | Environment and build                           | Settings                                                                                                   | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary automated Library contract              | Local final PR5B `npm run mobile:check`         | Mocked Convex, account epoch, status, alert, and accessibility APIs; no rendered OS text or spoken output  | Pass    | All 40 mobile suites and 423 tests passed, together with ESLint, native TypeScript, iOS/Android production bundle export, Expo dependency validation, the single-runtime check, and all 20 Expo Doctor checks. Coverage includes subject-bound reads/writes, account-epoch clearing, stale callback and confirmation races, mutation deduplication, query-echo and concurrent-reversal status ordering, hidden-route suppression, label-in-name, state, confirmation, and deterministic mocked input-focus recovery. Automated focus calls do not prove physical screen-reader focus landing. |
| Supplementary iOS signed-account Library artifact     | No PR5B signed-in iOS artifact run recorded     | 200% and largest text; portrait/landscape; light/dark; Bold Text and Increase Contrast                     | Not run | Install the reviewed artifact, complete a real Account A sign-in, and exercise Article save/remove, same-account web synchronization, Library traversal, confirmation, retry, and account switching. Simulator inspection cannot satisfy VoiceOver or physical gates.                                                                                                                                                                                                                                                                                                                         |
| Supplementary Android signed-account Library artifact | No PR5B signed-in Android artifact run recorded | 200% and maximum font/display separately and together; portrait/landscape; light/dark; High Text Contrast  | Not run | Install the reviewed APK, complete a real Account A sign-in, and exercise Article save/remove, same-account web synchronization, Library traversal, confirmation, retry, and account switching. Emulator evidence remains supplementary.                                                                                                                                                                                                                                                                                                                                                      |
| Signed iOS VoiceOver, Library save/remove and sync    | No trusted physical iPhone attached             | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast         | Blocked | Register and connect a supported iPhone, install a signed build, and complete the PR5B additions below. VoiceOver is unavailable in Simulator.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Signed Android TalkBack, Library save/remove and sync | No physical Android device attached             | Maximum font and display sizes separately and together; portrait/landscape; light/dark; High Text Contrast | Not run | Install the signed build on named hardware and complete the PR5B additions below. Emulator results remain supplementary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Foreground full-summary audio contract

This slice extends the native Article without carrying earlier Article evidence
forward as audio evidence. Within the loaded article document, the current
reading order is the one visible summary lead sentence, the full-summary player,
the optional full-text disclosure and its expanded remainder, real section
headings and complete paragraph stops, then source, media, license, and richer-web
content. Route navigation, heading, status, and Library controls remain ahead of
the article document. The audio addition must also preserve this contract:

- Loading an Article never requests, stages, or plays audio. Only activation of
  `Play full summary audio` may begin preparation. The resulting audio covers the
  canonical full summary even while the text remainder is collapsed.
- The player remains one operable control whose visible and accessible name
  follows its state: play, cancel preparation, pause, resume, replay, or retry.
  Preparing, playing, paused, finished, stopped, cancelled, and safe failure
  status is visible. Time progress is readable on demand but is not a live region
  and must not announce on every update.
- `Show full text summary` begins collapsed with programmatic expanded state set
  to false and no hidden remainder in the accessibility tree. Activation keeps
  focus on the same control, changes it to `Hide full text summary` with expanded
  state true, and reveals the complete unclamped remainder without repeating the
  lead. A one-sentence summary omits the disclosure; an absent summary omits both
  disclosure and player.
- Playback is foreground-only. Leaving the Article, changing article or account
  epoch, backgrounding the app, or unmounting releases the player and disposable
  cache lease and deactivates the audio session. Returning never auto-resumes or
  issues a new request. No lock-screen/background controls, microphone prompt,
  recording mode, storage permission, download affordance, playlist, or offline
  claim may appear.
- The temporary MP3 handoff is content-type and exact-length checked, bounded to
  16 MiB, stored only under the app cache, and deleted on controlled release.
  Stale entries are scavenged once by the shared store during a cold JavaScript
  runtime. It is not Library state or an offline cache.
- Player, disclosure, status, and error copy remain complete at 200% and maximum
  text/display settings. The control stays at least 48 by 48, reflows without a
  fixed text height, exposes visible focus, and does not rely on color, timing,
  or sound alone.

| Gate                                                   | Environment and build                                             | Settings                                                                                                   | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplementary foreground-audio configuration and seams | Focused local config Jest and `ts-archunit`; current working tree | Generated iOS/Android config introspection and static import graph; no native audio session                | Pass    | All 15 app-variant tests pass and `npm run arch` passes. Introspection proves no microphone usage string, audio background mode, recording/background service permission, or Expo audio service. Architecture permits `expo-file-system` and `expo-audio` only in the dedicated ephemeral store and foreground runtime. This does not prove hardware behavior. |
| Signed iOS VoiceOver, foreground summary audio         | No trusted physical iPhone attached                               | Largest Larger Accessibility Size; portrait/landscape; light/dark; Bold Text and Increase Contrast         | Blocked | Register and connect a supported iPhone, install a signed build, and complete the foreground-audio additions below. VoiceOver is unavailable in Simulator. Record exact order and speech, real playback and interruption behavior, focus retention, lock-screen absence, permission prompts, and cache cleanup; automated tests cannot satisfy this gate.      |
| Signed Android TalkBack, foreground summary audio      | No physical Android device attached                               | Maximum font and display sizes separately and together; portrait/landscape; light/dark; High Text Contrast | Not run | Install the signed build on named hardware and complete the foreground-audio additions below. Record exact order and speech, real playback and interruption behavior, focus retention, notification/lock-screen absence, permission prompts, and cache cleanup. Emulator results remain supplementary and cannot satisfy this gate.                            |

## Physical-device script

Record each platform separately. The shared script covers Home, Search, and the
native Article reading contract while retaining the brand-reflow checks from
the foundation. Run the foreground full-summary audio, PR5A Account, and PR5B
Library additions afterward. A PR4A handoff result is historical and cannot
satisfy an Article step.

1. Install the signed preview build from a clean state.
2. Test a 200% text-size baseline, then set the device to its largest text size.
   On Android, also test maximum display size separately and together with
   maximum font size.
3. Enable VoiceOver or TalkBack before cold-launching the app.
4. Confirm the first forward navigation reaches `Curio Garden` without surprise
   focus and that `Curio` and `Garden` remain whole visual words.
5. Traverse Home forward and backward. Record the exact spoken name, role,
   value, state, and hint for every item, including the visible search label,
   editable field, and Search button. Confirm the input and button are separate
   stops.
6. Submit an empty topic and verify the visible validation alert. Correct it,
   submit a nonempty topic over throttled networking, and confirm that the
   destination heading receives focus exactly once.
7. Move away from the status while the request is pending. Confirm the searching
   and result-count updates are each announced once without moving focus, then
   repeat with no results, a request error, and `Try again`. Refine to a new
   term and confirm its updated heading receives focus once; retry the same term
   and confirm it does not.
8. Traverse results in both directions. Confirm each complete result is one link
   whose speech includes its ordinal, title, and nonempty description, with no
   duplicate descendant stops. Activate only on release.
9. Open a result over throttled networking. Confirm focus reaches the one
   persistent Article heading exactly once and loading is announced from one
   persistent status node. Move away before loading completes; confirm the
   title/status update does not return focus to the heading or status.
10. Repeat Article loading with a request failure. Confirm concise visible error
    copy, one announcement path, and an operable `Try again`. Move focus before
    retrying and confirm that loading and success reuse the heading/status
    identities without stealing focus or exposing stale content.
11. Traverse a successful Article in both directions and record exact speech for
    its title and route controls. Within the article document, confirm the exact
    order is one visible summary lead sentence, the full-summary player, the
    collapsed `Show full text summary` disclosure, section headings and
    paragraphs, source/media content and any image attribution, source/license
    links, then the richer-web explanation/link. Expand the disclosure and
    confirm its remainder follows that same control without duplicating the
    lead. Confirm a cache-derived time is called fetched or retrieved, or
    omitted, and is never announced or displayed as `Last edited`.
12. Choose a long, multi-section article. Use the iOS headings rotor or Android
    Reading Controls to reach every real section heading in source order, with
    no duplicate article title or decorative headings. Confirm that a
    heading-only parent remains before populated child subsections. Read forward
    and reverse across paragraph boundaries: each ordinary paragraph is one
    bounded stop; an exceptionally long paragraph may split losslessly at safe
    boundaries. Nothing is truncated, and the article is neither one enormous
    stop nor split into arbitrary sentence stops. Explore by touch and confirm
    visual position does not change logical order.
13. Exercise a valid lead thumbnail and a missing or failed image. Confirm the
    valid image has a concise article-related name, visible creator/source/license
    attribution remains independently readable, and the failure removes any
    empty graphic stop while exposing persistent visible fallback copy. Record
    whether valid attribution remains available in the failure state.
14. Activate the source, license, media-attribution, and richer-web links. Record
    each exact `https` destination, return to the Article, and verify focus
    behavior. Where a reviewed fixture or blocked-handler scenario permits,
    verify that unsafe/malformed targets are not opened and that an external-app
    launch failure remains visible and retryable. Confirm the web handoff names
    galleries, broader context, and citation detail without implying that web
    is required for full-summary audio or that section/playlist playback,
    background media, offline/download, or push features exist natively.
15. Activate `Back to search` after reading deep into the Article and record
    where focus returns. Confirm no hidden Article descendants remain reachable.
16. Cold-launch a valid link for the build's app scheme and confirm it reaches
    the same native Article contract. Confirm one malformed or untrusted incoming
    location falls back safely to Home. Open the equivalent canonical HTTPS URL
    and verify that it remains on web in this slice; do not record a Universal
    Link or Android App Link pass before those OS associations exist.
17. Repeat Home, Search, Article success, Article error/retry, image failure, and
    external-link return at the 200% baseline and maximum text/display settings,
    in portrait and landscape, and in light and dark appearance. Scroll with the
    screen reader active and confirm all long content remains one-dimensionally
    reachable, no focus is obscured, and no text clips, overlaps, truncates, or
    requires horizontal scrolling. Repeat with bold text, increased/high
    contrast, and reduced motion where applicable.
18. Record failures as issues; never convert a simulator, emulator, Jest, or
    accessibility-tree result into a physical-device pass.

### Foreground full-summary audio additions

Run these after the shared Home/Search/Article script on each platform, while
signed out and again within a signed-in account where the script calls for an
account transition:

1. Open an Article with a multi-sentence summary over throttled networking. Do
   not activate the player. Confirm no audio request, preparation status, sound,
   system media session, or permission prompt occurs. Traverse the visible lead,
   `Listen to the full summary` player, and collapsed `Show full text summary`
   control in that order. Confirm the remainder is absent from forward, reverse,
   rotor/Reading Controls, and touch traversal.
2. Activate `Play full summary audio` once. Confirm the same control becomes
   `Cancel preparing summary audio`, preparation is visible and announced once,
   and no focus jump occurs. Cancel under throttled networking and confirm a late
   response cannot start sound or revive a stale status. Start again and confirm
   the full summary plays only after preparation succeeds.
3. While the disclosure remains collapsed, listen through the transition from
   its visible lead into the text remainder. Compare against the complete
   visible summary and record any missing, duplicated, stale-revision, or
   out-of-order narration as a failure. Expanding or collapsing the text must
   not interrupt playback or duplicate the lead.
4. Exercise `Pause full summary audio`, `Resume full summary audio`, completion,
   and `Replay full summary audio`. Record each exact spoken name, role, state,
   hint, visible status, and focus position. Confirm status transitions announce
   once while elapsed-time updates remain quiet unless the user navigates to the
   time text. Verify the disclosure keeps the same focus stop as its label and
   expanded state change between `Show` and `Hide`.
5. While preparing and while playing, separately navigate Back, open another
   Article, background the app, and lock the device. Confirm playback stops, the
   audio session and temporary file are released, no lock-screen or notification
   media control remains, and returning never resumes or requests audio until a
   new activation. Repeat a signed-in preparation while signing out or switching
   from Account A to Account B; no prior-account response, status, or sound may
   survive the epoch change.
6. Exercise offline start, request timeout, malformed or interrupted response,
   playback failure, and retry. Confirm only concise safe copy appears, the
   single control remains operable, no backend or filesystem detail is exposed,
   and cancelled or failed bytes are not playable later. Restore networking and
   confirm retry succeeds without stealing focus.
7. Inspect operating-system permissions and prompts. Confirm the build never
   requests microphone, recording, media-library, file/storage, notification, or
   background-audio permission for this feature. No UI may describe the staged
   cache file as saved, downloaded, available offline, or part of Library.
8. Repeat the lead/player/disclosure sequence and every player label/status at
   the 200% baseline and maximum text/display settings, in portrait and
   landscape, and in light/dark, bold/high-contrast, and reduced-motion modes.
   Confirm one-dimensional reachability, a visible unobscured 48-point target,
   complete unclamped labels, and no clipping, overlap, truncation, horizontal
   scrolling, or sound-only state.

### PR5A Account additions

Run these after the shared Home/Search/Article script on each platform:

1. From Home, traverse from the public search task to `Account`. Confirm it is
   one named button with an explanatory hint and that adding it did not merge,
   hide, or reorder the search input and Search button.
2. Activate Account. Confirm focus reaches `Account & data` exactly once and
   does not return there when loading, connecting, error, or ready state copy
   changes. Traverse all content forward and backward.
3. While signed out, record the visible and spoken guest status. Activate
   `Sign in`; confirm one operating-system authentication session opens Clerk's
   hosted Account Portal. Confirm Account status stops announcing before the
   transition and no background app content interrupts the hosted flow.
4. Traverse every Account Portal field, instruction, error, method, and dismiss
   control. Record label, role, value, state, hint, reading order,
   required/error announcement, keyboard behavior, and largest-text reflow.
   Complete both email and every displayed social method in the signed build;
   Google is enabled but has no signed acceptance yet. Record any
   rendered-but-broken method as a failure.
5. Cancel from the hosted session, use Android system Back, and use the iOS
   authentication-session dismissal where supported. Confirm each returns to
   the app once, background status did not speak over the transition, and focus
   returns to `Sign in` once.
6. Complete email sign-in and Google sign-in separately. Confirm the callback
   returns through the build's registered app route without a stray focus jump,
   the Account route announces connected status only after the validated
   session becomes active, and a logical app focus destination is restored.
   Attempting to open a callback-looking URL outside an active hosted flow must
   not create or replace a session.
7. Read the connected profile in both directions. Confirm only normalized name
   and email are exposed, with no duplicate descendants and no Clerk user ID,
   Convex subject, issuer, session, token, or raw backend error in speech,
   accessibility inspection, screenshots, or logs.
8. Activate Sign out twice rapidly. Confirm only one operation runs, profile
   details disappear immediately, the busy state is visible and announced, and
   success reaches guest mode. Exercise a blocked-network failure and confirm
   safe retry copy without restoring another account's data.
9. Sign in as Account A, switch to Account B, and sign out/in while requests are
   throttled. Confirm no Account A name, email, status, error, or deferred focus
   operation appears after Account B becomes active. Public search must remain
   operable throughout bridge failure and recovery.
10. In every build variant, confirm there is no export, permanent-deletion, or
    ordinary-web account-management link. Confirm the visible explanation does
    not imply that an independent browser Clerk session is the active native
    account, and record the missing account-bound native lifecycle flow as a
    release gate. Repeat the full Account and hosted-auth flow at maximum
    text/display settings, in portrait and landscape, and in light/dark,
    bold/high-contrast, and reduced-motion modes without clipping, overlap,
    horizontal scrolling, or unreachable content.

### PR5B Library additions

Run these after the shared script and the Account sign-in prerequisites on each
platform:

1. From Home, traverse through the public Search task, Library, and Account in
   both directions. Confirm Library is one named 48-point button and that its
   addition did not merge, hide, or reorder the search field and Search button.
2. Open Library while signed out. Confirm focus reaches the one `Library`
   heading exactly once, one persistent status reports the account requirement,
   `Go to Account` and `Start exploring` remain distinct controls, and public
   reading is not described as account-only.
3. Sign in as Account A, open an unsaved Article, and record the exact visible
   and spoken label, role, state, and hint for its save action. Activate it twice
   rapidly. Confirm one mutation runs, visible in-progress wording remains
   complete, busy/disabled state is announced without dropping focus, success exposes the visible
   label “Saved to Library” with selected state, and no raw backend detail
   appears.
4. Confirm the saved Article appears in Account A's web Library. Save or remove
   a different entry on web and confirm the native Library synchronizes for the
   same account without requesting focus. Repeat with a blocked-network failure
   and `Try again`; status and errors remain visible, concise, and retryable.
   Then leave VoiceOver or TalkBack on an article row and remove that exact row
   on web. Record whether focus lands on a surviving row or the Library heading;
   keyboard/input-focus automation does not satisfy this cursor-recovery check.
5. Traverse a populated Library forward and backward. For every entry, record
   the article link's exact title/date speech and the sibling Remove button's
   name, role, state, and hint. Confirm neither control contains the other, both
   activate only on release, and no visual descendant becomes a duplicate stop.
6. Request removal and inspect the confirmation's title, message, Cancel, and
   Remove controls. Cancel once and confirm the entry remains. Then remove the
   entry and confirm focus moves to the next article link, or the previous link
   when no next entry exists. Remove the final entry and confirm focus moves to
   the Library heading, not a hidden control or transient status.
7. Open an Article from Library and confirm its Back action is honestly named
   `Back to Library`. Remove and re-save it from Article, exercising success,
   failure, retry, and a response that completes after leaving the route. Confirm
   stale status does not appear and no async update steals focus.
8. While Library queries and mutations are throttled, sign out, sign back in,
   and switch from Account A to Account B. Confirm Account A's entries, saved
   state, busy state, errors, announcements, and deferred removal focus disappear
   before Account B loads and never return after a stale completion.
9. Cold-launch without networking and record the honest unavailable or retry
   behavior. No screen or announcement may claim that articles were downloaded,
   stored on device, or available through an offline mode. Restore networking
   and confirm the account Library can recover without a surprise focus move.
10. Repeat signed-out, loading, error/retry, empty, populated, confirmation,
    post-removal focus, Account A/B isolation, and Article save/remove scenarios
    at the 200% baseline and maximum text/display settings, in portrait and
    landscape, and in light/dark, bold/high-contrast, and reduced-motion modes.
    Confirm complete one-dimensional reachability, visible unobscured focus, and
    no clipping, overlap, truncation, or horizontal scrolling.

## Evidence record template

Copy this block into the pull request or a linked test record for each device:

```text
Commit SHA:
Build profile and EAS build ID/artifact URL:
Date and tester:
Physical device model:
OS version:
VoiceOver/TalkBack version:
Appearance and orientation:
Text/display/accessibility settings:
Scenario result (Pass/Fail/Blocked/Not run):
Exact speech and focus transcript:
Screenshot or recording link:
Issue link for every failure:
```

## Automated evidence boundary

The native Jest suites prove exact semantic colors and contrast guardrails,
real per-platform font names and weights, deliberate display-text caps with
uncapped task copy, one word-safe brand heading, 48-by-48 control geometry,
visible press/focus/state cues, safe-area scrolling, preference listener
cleanup, and platform-specific status behavior. The PR4A suites also prove the
search field's visible and accessible label, separate input and submit controls,
one-stop named result links, unclamped result text, normalized submissions,
persistent status-node identity, stale-request handling, safe visible errors,
canonical route and historical web-handoff arguments, one mocked focus request
per new route context, and no refocus on async completion.

PR4B's passing automated suites establish the rendered loading/error/retry
state machine; stable route-heading and status identity; mocked no-focus-theft
contract; header roles and source order; separate unclamped paragraph nodes;
image names, visible attribution, and failure fallback; HTTPS sanitization;
external-link roles, exact arguments, stale-launch handling, and visible safe
launch errors; and omission of cache-derived editorial-history claims.

PR5A's automated contract establishes the privacy-safe Account projection;
exact internal Clerk/Convex subject correlation; public-reading isolation;
opaque account epochs; stale-operation rejection; deduplicated sign-out; and
the app-side hosted-auth start, cancel, completion, error, announcement
suppression, and focus-return state machine. It does not inspect Clerk's hosted
Account Portal or independently prove the SDK's PKCE, nonce, callback, and
created-session validation.

When its aggregate evidence row passes, PR5B's automated contract covers
account-scoped bookmark projection; account-epoch clearing; stale and duplicate
operation handling; safe retryable failures; persistent Library heading/status
identity; visible and programmatic saved/busy state; sibling article-link and
Remove semantics; removal confirmation; and deterministic mocked focus after a
committed removal. It also models input-focus recovery when synchronization
removes a tracked row. React Native does not surface physical VoiceOver or
TalkBack cursor movement through those cross-platform callbacks, so it cannot
establish same-account web synchronization against a real signed session,
exact speech, native dialog behavior, or physical focus landing.

The foreground-audio suites model explicit activation, canonical full-summary
requests, cancellable preparation, pause/resume/replay labels, quiet progress
updates, safe failures, route/app/account lifecycle teardown, bounded exact-byte
cache staging, and idempotent cleanup. Article tests establish the
lead-player-disclosure source order, lossless disclosure text, stable expanded
state, and no duplicate lead. Config introspection and architecture rules prove
the declared background/recording capability exclusions and narrow native
library import seams. None of that runs a physical audio session or a real
screen reader.

Those suites cannot prove spoken output, rotor/Reading Controls behavior,
route-entry or back-focus landing, real long-article reading order, native image
loading or decoding, native font measurement, actual 200% or maximum OS text
and display scaling, portrait/landscape reflow, light/dark or contrast
appearance, focus visibility, external-app return focus, or touch exploration.
Heading- and paragraph-role assertions do not prove rotor/Reading Controls
navigation, and an accessibility API mock does not establish where a physical
screen reader landed. Those remain signed physical-device gates across Article
success, error/retry, image failure, and external-link failure states.
Hosted-auth launch, Account Portal reading order and reflow, browser dismissal,
callback return, background-announcement isolation, restored app focus, and
email or Google completion likewise remain signed physical-device gates.
Exact save/remove speech and state, native confirmation traversal, post-removal
focus, same-account web synchronization, account-switch isolation, and Library
reflow likewise remain open until the PR5B signed-account artifact and physical
device rows are completed.
Foreground audio output, interruption and route/background teardown, absence of
system media controls and permission prompts, exact player-status speech, quiet
progress updates, disclosure focus retention, and cache cleanup likewise remain
open until the signed iOS and Android foreground-audio rows are completed.

Use Apple's
[accessibility testing guidance](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app)
for the physical VoiceOver procedure.
