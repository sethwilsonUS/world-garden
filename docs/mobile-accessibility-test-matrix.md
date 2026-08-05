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

## Physical-device script

Record each platform separately. This script now covers the current Home,
Search, result, and web-handoff slice while retaining the brand-reflow checks
from the foundation.

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
9. Open a result and confirm focus reaches the article-title heading once.
   Activate `Open article on Curio Garden web`, verify the exact canonical host
   and path, return from the browser, and test `Back to search`. Record where
   focus returns. Also exercise the visible browser-launch error if the platform
   permits a safe test double or blocked-handler scenario.
10. Cold-launch a valid link for the build's app scheme and confirm it reaches
    the same handoff. Confirm one malformed or untrusted incoming location falls
    back safely to Home. Open the equivalent canonical HTTPS URL and verify that
    it remains on web in this slice; do not record a Universal Link or Android
    App Link pass before those OS associations exist.
11. Use the iOS headings rotor or Android Reading Controls to verify the primary
    and real section headings without duplicate brand or article-title entries.
    Explore by touch and confirm visual position does not change logical order.
12. Repeat in portrait and landscape, light and dark appearance. Scroll with the
    screen reader active and confirm all long result and handoff copy remains
    reachable and no focus is obscured.
13. Repeat the primary task with bold text, increased contrast, and reduced
    motion where applicable.
14. Record failures as issues; never convert a simulator, emulator, Jest, or
    accessibility-tree result into a physical-device pass.

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
cleanup, and platform-specific status behavior. The current-slice suites also
prove the search field's visible and accessible label, separate input and
submit controls, one-stop named result links, unclamped result text, normalized
submissions, persistent status-node identity, stale-request handling, safe
visible errors, canonical route and web-handoff arguments, one mocked focus
request per new route context, and no refocus on async completion.

Those suites cannot prove spoken output, rotor/Reading Controls behavior,
route-entry or back-focus landing, native font measurement, actual 200% or
maximum OS scaling, visual reflow, focus visibility, or touch exploration. The
route-entry heading requirement remains a manual screen-reader gate; asserting
an accessibility API call in a mock would still not establish where a physical
screen reader landed.

Use Apple's
[accessibility testing guidance](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app)
for the physical VoiceOver procedure.
