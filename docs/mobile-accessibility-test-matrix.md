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

## Interaction contract

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

## Physical-device script

Record each platform separately. A future feature screen may add scenarios, but
must not remove these checks.

1. Install the signed preview build from a clean state.
2. Set the device to the largest text size. On Android, also test maximum
   display size separately and together with maximum font size.
3. Enable VoiceOver or TalkBack before cold-launching the app.
4. Confirm the first forward navigation reaches `Curio Garden` without surprise
   focus.
5. Traverse forward and backward through the interaction contract and record
   the exact spoken name, role, value, state, and hint for every item.
6. Use the iOS headings rotor or Android Reading Controls to confirm exactly one
   `Curio Garden` heading.
7. Explore by touch and confirm visual position does not change the logical
   order.
8. Repeat in portrait and landscape, light and dark appearance. Scroll with the
   screen reader active and confirm the final supporting copy is reachable and
   no focus is obscured.
9. Repeat the primary task with bold text, increased contrast, and reduced
   motion where applicable.
10. Record failures as issues; never convert a simulator, emulator, Jest, or
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
cleanup, and platform-specific status behavior. They cannot prove spoken
output, rotor/Reading Controls behavior, native font measurement, OS scaling,
reflow, focus visibility, or touch exploration.

Use Apple's
[accessibility testing guidance](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app)
for the physical VoiceOver procedure.
