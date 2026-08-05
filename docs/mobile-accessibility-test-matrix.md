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
2. `A quieter way to explore and listen to Wikipedia.`
3. `FOUNDATION`
4. `Development client foundation ready.`
5. `Expo Go is optional; signed native builds are the release gate.`

There must be no duplicate, blank, or unlabeled elements. Forward and reverse
navigation must be predictable, all content must remain reachable, and the
heading must still be exposed as the single screen heading when it wraps.

At the largest text and display settings, content must reflow without clipping,
overlap, truncation, or two-dimensional scrolling. Portrait and landscape,
light and dark appearance, and safe-area clearance are separate checks.

## Foundation evidence — 2026-08-04

These runs establish the development baseline. They do not satisfy the future
physical-device beta gate.

| Gate | Environment and build | Settings | Result | Evidence |
| --- | --- | --- | --- | --- |
| Supplementary iOS semantics and reflow | iPhone 17 Pro Simulator, iOS 26.5, local Release configuration with embedded JavaScript bundle | `accessibility-extra-extra-extra-large`; light and dark; portrait and landscape | Pass | Accessibility tree contained exactly the five contract items in order and one heading. The title displayed as `Curio` / `Garden` in portrait and `Curio Garden` in landscape; the title multiplier is capped at 2.25 while task copy remains uncapped. |
| Supplementary Android screen reader and reflow | Pixel Android Virtual Device, Android 16/API 36, locally signed Release APK, TalkBack 16.0 | Font scale 2.0; light portrait and landscape | Pass | TalkBack focus advanced through all five contract items, stopped cleanly after the final item, and reversed from the final item to the card title. The landscape layout exposed the complete card without clipping. No development-client control entered the reading order. |
| Physical iOS VoiceOver | No trusted iPhone attached and no device registered with EAS | Largest Larger Accessibility Size; portrait/landscape; light/dark | Blocked | Register and connect a supported iPhone, install a signed preview build, then complete the physical script below. VoiceOver is not available in Simulator. |
| Physical Android TalkBack | No physical Android device attached | Maximum font and display sizes separately and together; portrait/landscape; light/dark | Not run | Install the signed preview APK on named hardware, then complete the physical script below. |

The iOS Release build also proves the Expo/Xcode throughline against matching
Xcode 26.6 and iOS 26.5 Simulator runtimes. The Android Release APK launches
from its embedded bundle without Metro or Expo development UI.

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

`FoundationScreen.test.tsx` proves the heading name and role, the deliberate
2.25 title multiplier, and the presence of the release-gate copy. It cannot
prove spoken output, rotor behavior, OS scaling, reflow, focus visibility, or
touch exploration.

Use Apple's
[accessibility testing guidance](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app)
for the physical VoiceOver procedure.
