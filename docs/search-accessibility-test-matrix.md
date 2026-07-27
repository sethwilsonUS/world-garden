# Search accessibility test matrix

This runbook records what Curio Garden's automated checks can prove and what
must be observed with real browsers, assistive technology, zoom, and
magnification. A simulated viewport or an accessibility-tree snapshot is not
reported as a screen-reader result.

## Behavior contract

Search must preserve all of these behaviors:

- Home and blank search pages do not move focus on load or summon a software
  keyboard.
- Results arriving asynchronously do not move focus.
- One stable polite live region announces searching, result count, or no
  results. The error alert is the only error announcement.
- Result links use native Tab, Shift+Tab, and Enter behavior.
- Number, arrow, Home, and End keys remain available to the browser and
  assistive technology.
- Search headings, titles, descriptions, and controls reflow without
  page-level horizontal scrolling at genuine 200% and 400% browser zoom.

## Evidence record

For every manual run, record:

- build commit and test URL;
- date and tester;
- operating system, browser, and assistive-technology versions;
- screen-reader mode, Quick Nav state, input method, zoom, and magnifier level;
- scenario IDs exercised;
- exact speech and focus transcript where announcements are involved;
- `Pass`, `Fail`, `Blocked`, or `Not run`;
- an issue link for every failure.

`Blocked` means the named real environment was unavailable or could not
complete the scenario. It does not mean an automated substitute passed.

## Scenarios

| ID | Procedure | Expected result |
| --- | --- | --- |
| S1 | Open the home page without touching the keyboard or screen. | The page context is available first; the search field is not focused automatically. |
| S2 | Open the blank search page. On mobile, observe the software keyboard. | The heading and instructions remain available; focus stays neutral and the keyboard does not open. |
| S3 | Submit a search over throttled networking, move focus to the refinement field while loading, and let results arrive. | “Searching Wikipedia…” and one result-count update are announced; focus stays in the refinement field. |
| S4 | Browse results with native commands. Try Tab, Shift+Tab, Enter, arrows, Home, End, digits 1–6, and modified digits. | Tab order is logical and Enter opens the chosen result. Curio Garden does not intercept arrows or digits. NVDA/JAWS heading keys continue to work in browse/virtual mode. |
| S5 | Repeat with an empty response and an error response. | No-results is announced once. An error is announced once by the alert, without a competing polite message. |
| S6 | Repeat with long unbroken query, title, and description text at genuine 200% and 400% browser zoom. Test OS magnification separately. | No page-level horizontal scrolling, clipped controls, hidden focus indicator, or unexpected viewport jump occurs. |

## Compatibility matrix

Update this table in the same pull request as the completed test evidence.

| Configuration | Modes and scenarios | Status | Evidence |
| --- | --- | --- | --- |
| VoiceOver + Safari, macOS | Quick Nav on/off; S1–S6 | Blocked | S2 and the focus/key portions of S4 passed with VoiceOver enabled. Exact speech, live-region order, and reliable Quick Nav automation could not be captured, so this is not recorded as a complete VoiceOver pass. |
| VoiceOver + Safari, iOS | Touch exploration and software keyboard; S1–S6 | Blocked | No physical iPhone was available. [Apple documents that VoiceOver is unavailable in Simulator](https://developer.apple.com/documentation/Accessibility/performing-accessibility-testing-for-your-app). |
| Mobile Safari, iPhone Simulator (without VoiceOver) | Touch, portrait/landscape, page zoom; S2, S4, S6 | Pass | iPhone 17 Pro, iOS 26.3. Touch search and results worked; portrait and landscape reflowed; 100%, 200%, and Safari's 300% maximum remained usable. This is supplementary evidence, not an iOS VoiceOver result. |
| NVDA + Firefox, Windows | Browse/focus modes; S1–S6 | Blocked | No Windows/Firefox/NVDA environment was available. |
| NVDA + Chrome, Windows | Browse/focus modes; S1–S6 | Blocked | No Windows/Chrome/NVDA environment was available. |
| JAWS + Chrome, Windows | Virtual/forms modes; S1–S6 | Blocked | No Windows/JAWS environment was available. |
| TalkBack + Chrome, Android | Touch; S1–S6; optional hardware keyboard for S4 | Blocked | No Android/TalkBack environment was available. |
| Windows Magnifier + Chrome or Edge | Focus/caret tracking; S3, S4, S6 | Blocked | No Windows Magnifier environment was available. Browser zoom and OS magnification remain separate checks. |
| Keyboard-only Chrome, Firefox, Safari | Browser zoom 100%, 200%, 400%; S1–S6 | Blocked | Safari focus and native-keyboard subchecks passed. Chrome could not launch in this environment and Firefox was unavailable; genuine desktop 200%/400% zoom therefore remains blocked. |
| macOS Zoom + Safari | Focus tracking; S3, S4, S6 | Blocked | The global magnifier shortcut could not be exercised reliably through the automation input path. The temporary shortcut setting was restored without claiming a result. |

## Manual evidence from 2026-07-27

- Build: `e6dc7e83890d7f26aa10df09515831a530fb2ed8` on
  `codex/search-accessibility`
- Test URL: `http://127.0.0.1:3000`
- Tester: Codex, under the repository owner's authorization
- Desktop: macOS 26.5.2 (25F84), Safari 26.5.2
- Mobile supplement: iPhone 17 Pro Simulator, iOS 26.3

| Check | Result | Observation |
| --- | --- | --- |
| Blank search page, Safari, keyboard only (S2) | Pass | Initial focus remained on the document. The search field did not autofocus and no input UI was summoned. |
| Result focus and native keys, Safari with VoiceOver enabled (S4) | Pass | Results did not force focus to the first link. Native forward/backward focus order reached adjacent result links. `2`, Control+`2`, Down Arrow, Home, and End left the focused result and URL unchanged. Safari required Option+Tab because its system “Tab to highlight each item” preference was off. |
| VoiceOver announcements, rotor, and Quick Nav (S3–S5) | Blocked | The accessibility tree and VoiceOver focus indicator were observable, but the test harness could not capture a trustworthy speech transcript or send global VoiceOver cursor commands reliably. |
| Mobile Safari touch search (S2, S4) | Pass | The blank page opened without focusing the field. A touch-selected query submitted normally and rendered ten results without a forced software-keyboard or result-focus jump. |
| Mobile Safari reflow and page zoom (S6) | Blocked | Portrait and landscape passed at 100%. The page reflowed at genuine 200% and at Safari's 300% maximum without page-wide horizontal scrolling. Mobile Safari does not offer 400%; desktop 400% remains blocked. |
| Chrome genuine zoom (S6) | Blocked | The installed Chrome bundle failed to launch in this environment, so no Chrome zoom result is claimed. |
| macOS Zoom focus tracking (S3, S4, S6) | Blocked | App-targeted input could not drive the global magnifier shortcuts reliably enough to produce defensible focus-tracking evidence. |

After testing, VoiceOver and its caption panel were returned to their original
off states, Safari page zoom was returned to Actual Size, macOS Zoom shortcut
control was returned to off, Mobile Safari page zoom was reset to 100%, the
Simulator text size was returned to `large`, and the simulated phone was shut
down.

## Automated evidence

| Check | What it covers | What it cannot prove |
| --- | --- | --- |
| `components/SearchResultsList.interaction.test.tsx` | Stable live-region node, focus preservation, stale requests, empty/error states, and non-intercepted keys. | Spoken output, virtual-cursor modes, browser focus rendering, touch, or zoom. |
| `e2e/search-accessibility.spec.ts` | Chromium focus behavior, native tab order, axe serious/critical checks, and long-content reflow at 640px and 320px CSS viewport proxies. | Real 200%/400% browser zoom, screen-reader speech, quick-key interception, software keyboards, touch exploration, or magnifier tracking. |

The 640px and 320px browser tests are reflow proxies for a 1280px-wide
viewport at 200% and 400%. They are useful regression checks, but the matrix
must keep genuine browser zoom results separate.
