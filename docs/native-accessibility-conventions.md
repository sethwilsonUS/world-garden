# Native accessibility conventions

Curio Garden treats accessibility as release behavior on iOS and Android.
Automated tests make the contract harder to regress, but only a signed build on
named physical hardware can satisfy the VoiceOver and TalkBack release gate.

These conventions apply to every route and reusable component under `mobile/`.
The current web application is the source of truth for visual language; native
code copies semantic values into a platform-owned theme and never imports web
components or CSS across the architecture boundary.

## Structure and reading order

- Keep JSX order, visual order, and expected assistive-technology order the
  same. Do not use React Native's experimental accessibility-order API.
- Expose one clear primary screen heading. Additional section headings may
  describe real subsections, but decorative lockups and glyphs stay out of the
  accessibility tree.
- A static card remains a collection of readable descendants. Do not collapse
  a heading, description, and controls into an unnamed or oversized focus stop.
- An interactive card is one named control. Any secondary action is a sibling,
  never a nested pressable.
- Hidden routes and overlays must hide their descendants from both the visual
  and accessibility trees. After a user-initiated route change, move
  screen-reader focus to the destination's primary heading once, after it is
  mounted. A newly submitted Search term establishes a new route context and
  focuses its updated results heading once. A same-term retry, async
  completion, or routine data refresh must retain the user's focus. Back
  navigation should restore the originating control when the platform stack
  supports it.
- A search result is one focus stop with the `link` role. Its ordinal, title,
  and nonempty description form one accessible name; its visual descendants
  are hidden from assistive technology. Never expose a duplicate title or a
  nested control inside the result link.
- A data-backed route owns one persistent primary heading and one persistent
  status node. Keep their identities stable across loading, success, error, and
  retry; changing their text must not remount them or request focus again.
  Route entry may focus the primary heading once. Async completion, failure,
  and same-route retry announce useful state without stealing focus.
- A Library entry is a visual card with two sibling focus targets: one named
  article link and one named Remove button. Never nest the Remove action inside
  the link or merge the saved date, navigation, and removal into one ambiguous
  control.
- In a long Article, expose every real section title as a heading in source
  order, including a heading-only parent that introduces populated child
  subsections. Keep each ordinary paragraph as one bounded screen-reader stop.
  An exceptionally long source paragraph may split losslessly at safe text
  boundaries into multiple bounded stops; do not collapse the whole article
  into one enormous stop, split prose into arbitrary sentence fragments, clamp
  lines, truncate, or ellipsize task content.

## Text, reflow, and contrast

- Leave font scaling enabled. Body, task, status, and error copy is uncapped.
  Deliberate caps are limited to large display typography and tiny decorative
  metadata, matching the current web hierarchy.
- Text-bearing controls use minimum dimensions and padding, never a fixed
  height. At larger text or display sizes, rows wrap or become vertical.
- Exercise both a 200% text-size baseline and every platform's maximum text and
  display-size combinations. Body, status, alert, input, result-title, and
  result-description text must remain complete and one-dimensionally
  scrollable. An automated assertion that text is unclamped is useful, but it
  does not prove native font measurement or visual reflow.
- The visual `Curio Garden` brand heading consists of two wrapping word units
  exposed as one heading. It may become `Curio` / `Garden`, but must never split
  within either word, truncate, ellipsize, or shrink to fit.
- Use `foreground`, `foreground2`, and `accent` only on their tested surfaces.
  The subtle `border` token is decorative. Essential control and focus
  boundaries use `controlBorder` or the higher-contrast accent token.
- Never communicate selection, error, busy, or disabled state through color
  alone. Preserve visible text or shape cues and the matching accessibility
  state.

## Controls and focus

- Every standalone pressable has a real minimum target of 48 by 48 React
  Native units, satisfying the stricter cross-platform baseline. Hit slop may
  supplement but never replace that geometry.
- Activate actions with `onPress`, after release. The visible label is included
  in the accessible name; supply a concise hint only when the outcome is not
  apparent from that label.
- Expose role and applicable `disabled`, `busy`, `selected`, `checked`, or
  `expanded` state. A disabled or busy control must not invoke its action.
- Hardware-keyboard focus receives a persistent at-least-two-unit accent boundary that
  is not obscured by the tab bar, keyboard, or future mini-player.
- Icon-only actions still have a visible 48-by-48 target and an explicit name;
  their glyph is decorative.
- A form's persistent visible label and accessible input name must agree. Keep
  the text input and its submit button as separate focus stops; do not collapse
  an editable field and an action into one control.
- Source, license, media-attribution, and richer-web actions expose the `link`
  role and a name that identifies their destination or purpose. Sanitize every
  externally supplied target and permit only complete `https` URLs; missing,
  malformed, credentialed, or non-HTTPS values render as noninteractive text or
  an unavailable state rather than being passed to the operating system.

## Article audio

- Keep the native Article source and accessibility order as one summary lead
  sentence; the article-audio heading, primary controls, time, synthetic-speech
  notice, and status; one persistent summary disclosure with the nonduplicated remainder while
  expanded; ordered audio-item rows; and then the complete Article text. The
  full canonical summary remains the summary narration input; the visual split
  never shortens or rewrites audio.
- The disclosure exposes its current `expanded` state and changes its visible
  label between `Show full text summary` and `Hide full text summary` without
  replacing the focused control. Collapsed summary text is absent from both the
  visual and accessibility trees.
- Playback begins only from a user press. Play All and every individually
  playable summary/section row retain an operable control through preparation,
  play, pause, completion, replay, cancellation, and safe retry states. Visible
  state words remain inside the accessible name while that name adds the
  article/section context and resulting action. Rows whose titles are spoken
  equivalently add their stable Play All position so their names remain
  distinguishable.
- Heading-only transitions and sections without source text are visibly labeled
  `Chapter transition` and `No source text`; neither becomes a false Listen
  control. Previous and Next expose their direction in both visible and
  accessible names and become programmatically disabled at queue bounds. If a
  focused boundary control becomes unavailable after a transition, it remains
  focusable, visibly focused, and inert instead of disappearing from focus.
- Announce meaningful preparation progress, current-item changes, playback,
  pause, completion, cancellation, and failure through one player status. Do
  not announce elapsed-time ticks, and do not duplicate the Article route's
  load or Library status.
- Leaving the active Article route or changing article/account epoch releases
  playback. Moving to the background cancels unfinished preparation, while an
  activation that has actually started playback survives ordinary backgrounding
  and screen lock. A created queue whose initial native play is still pending is
  cancelled rather than allowed to start later.
  Returning reconciles native status without generating, retrying, or resuming
  automatically. Release the native player before deleting every bounded
  private cache-file lease.
- This handoff exposes no microphone or recording permission, download, offline
  storage, or push-notification promise. Automated state and hierarchy checks
  are necessary but do not replace named-device VoiceOver/TalkBack operation,
  exact spoken-output, lock-screen, interruption, or maximum-text acceptance.

## Library and saved articles

- The current web application remains the design and copy authority. Native
  Library presentation adapts its layout to platform conventions without
  inventing a separate visual language or changing the account-backed meaning.
- The Article action uses `Save to Library` and `Saved to Library` as visible
  state labels, with an in-progress suffix while a mutation is pending. Its
  accessible name includes the article title and the matching save or remove
  purpose. Expose `selected` when saved and `busy` plus `disabled` while the
  request is pending. Keep the native control focusable and ignore repeat
  activation so Android does not strand screen-reader focus. Color is
  supplementary.
- Library owns one persistent `Library` heading and one persistent status node
  across signed-out, connecting, loading, error, empty, list, mutation, and
  retry states. Query completion and same-account synchronization may update
  the status and entries without refocusing a target that still exists. If the
  tracked input-focused row disappears, recover to a surviving row or the
  heading. React Native input-focus callbacks do not prove where a VoiceOver or
  TalkBack cursor landed, so that case remains a physical-device acceptance
  gate.
- Removing an entry is consequential and requires a named confirmation with
  distinct Cancel and Remove actions. Cancellation and failure retain a
  sensible focus position. After a committed removal, move focus
  deterministically to the next article link, otherwise the previous article
  link, otherwise the Library heading when the list becomes empty.
- Library data belongs only to the validated native account. On sign-out or an
  account-epoch change, clear entries, mutation state, errors, and deferred
  focus work before another account can load. A stale Account A query or
  mutation must not update Account B's UI or announce a result.
- Signed-out users retain public Search and Article reading and receive an
  honest route to Account. Do not create guest bookmarks, device persistence,
  downloads, offline article storage, or copy that implies saved articles are
  available offline.

## Article content and media

- Preserve the article title, provenance, summary, source section order, and
  paragraph boundaries. Native presentation may adapt spacing and typography,
  but it must not invent hierarchy or silently omit text within a supported
  section.
- A lead thumbnail is informative content. Give the image a concise accessible
  name tied to the article, keep creator/source/license attribution visibly
  adjacent, and expose safe attribution targets as links. Never use attribution
  text as the image's accessible name.
- While an image loads, preserve the surrounding article's order. If it is
  absent, unsafe, or fails to load, remove the broken graphic from the
  accessibility tree and show persistent visible fallback copy; retain any
  valid attribution required for the media.
- The native reader explicitly hands galleries, broader context, and citation
  details to the richer canonical web article until those structures have an
  equivalent native representation. The handoff explanation appears before its
  link and does not imply that opening the web is required to read the summary
  and supported sections already present natively.
- Cache metadata describes cache behavior, not editorial history. A value
  derived from `lastFetchedAt` may be labeled `Fetched` or `Retrieved`, or be
  omitted. It must never be labeled `Last edited`; only authoritative revision
  metadata can support an editorial-history claim.

## Status and motion

- Loading completion, errors, and consequential user-requested changes receive
  useful status feedback. Do not announce initial render, decorative changes,
  or every data refresh.
- Search keeps one persistent status node while it transitions from searching
  to an empty, singular, or plural result count. Ignore stale request
  completions and do not move focus when the message changes.
- Article keeps its single status node mounted while it transitions through
  loading, loaded, request error, and retry. Use the existing visible alert for
  a request failure rather than adding a second announcement source; clear or
  update obsolete status copy and leave retry operable without moving focus.
- Library keeps its single status node mounted while it transitions through
  account connection, query loading, empty/list results, retry, and save/remove
  feedback. Ignore stale account epochs, and do not refocus the route when a
  query or mutation status changes. A committed removal uses the deliberate
  focus destination defined above instead of the routine status path.
- Android uses a visible polite live region. iOS queues one explicit
  announcement for a meaningful state transition. Do not combine both paths on
  the same platform or repeat an unchanged message.
- Validation, request, and external-app launch failures use concise visible
  alerts without backend details. Clear an obsolete status before exposing a
  request error, keep the failed action retryable, and never announce the same
  failure through both an alert and a status node.
- Read reduced-motion preferences before starting nonessential motion and keep
  listening for runtime changes. Navigation and decorative animation stop when
  reduced motion is enabled; immediate state feedback remains.
- Respect bold text, increased contrast, reduced transparency, and platform
  high-contrast preferences. A preference may strengthen presentation but may
  not be the sole source of an accessible state.

## Required evidence

Before a native feature is called complete, run the
[native accessibility test matrix](./mobile-accessibility-test-matrix.md) on a
signed build. Record exact forward and reverse speech, heading navigation,
touch exploration, route/back focus, hardware keyboard focus, maximum text and
display sizes, portrait and landscape, light and dark appearance, bold text,
increased contrast, and reduced motion.

Simulator accessibility trees, Android emulators, Jest, lint, type checks, and
bundle checks are valuable supplementary evidence only. Never relabel one as a
physical VoiceOver or TalkBack pass.

The contract primarily protects WCAG 2.2 success criteria 1.3.1, 1.3.2, 1.4.3,
1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.1.1, 2.4.3, 2.4.6, 2.4.7, 2.4.11, 2.5.2,
2.5.3, 2.5.8, 4.1.2, and 4.1.3.
