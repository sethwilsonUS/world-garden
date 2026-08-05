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
- Expose one clear screen heading. Decorative lockups and glyphs stay out of
  the accessibility tree.
- A static card remains a collection of readable descendants. Do not collapse
  a heading, description, and controls into an unnamed or oversized focus stop.
- An interactive card is one named control. Any secondary action is a sibling,
  never a nested pressable.
- Hidden routes and overlays must hide their descendants from both the visual
  and accessibility trees. When navigation changes screens, announce or focus
  the new title once; routine data refreshes must not steal focus.

## Text, reflow, and contrast

- Leave font scaling enabled. Body, task, status, and error copy is uncapped.
  Deliberate caps are limited to large display typography and tiny decorative
  metadata, matching the current web hierarchy.
- Text-bearing controls use minimum dimensions and padding, never a fixed
  height. At larger text or display sizes, rows wrap or become vertical.
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

## Status and motion

- Loading completion, errors, and consequential user-requested changes receive
  useful status feedback. Do not announce initial render, decorative changes,
  or every data refresh.
- Android uses a visible polite live region. iOS queues one explicit
  announcement for a meaningful state transition. Do not combine both paths on
  the same platform or repeat an unchanged message.
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
