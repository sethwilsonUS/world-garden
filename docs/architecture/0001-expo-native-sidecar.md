# ADR 0001: Expo native sidecar

- Status: Accepted
- Date: 2026-08-04
- Owners: Curio Garden maintainers

## Context

Curio Garden's production application is a mature Next.js application deployed
from the repository root. Native background audio and operating-system media
controls are valuable, but converting or moving the web application would put
unrelated production behavior at risk.

The current stable native line is Expo SDK 57 with React Native 0.86.2. SDK 57
requires Node 22.13 or newer, iOS 16.4 or newer, Android 7/API 24 or newer, and
the React Native New Architecture. Curio Garden already uses Node 24.

## Decision

Add an npm workspace at `mobile/` and keep the existing Next.js application at
the repository root. The native app uses Expo Router, Continuous Native
Generation, development clients, and EAS Build. Generated `ios/` and `android/`
folders remain untracked; native configuration belongs in `app.config.ts` and
config plugins.

Expo Go is a convenience only. It is not a release or compatibility gate. This
avoids coupling development to App Store availability of a matching Expo Go
binary and supports native audio/auth configuration from the beginning.

The production identifiers are:

| Environment | Display name           | iOS bundle / Android package  | URL scheme            |
| ----------- | ---------------------- | ----------------------------- | --------------------- |
| Development | Curio Garden (Dev)     | `org.curiogarden.app.dev`     | `curiogarden-dev`     |
| Preview     | Curio Garden (Preview) | `org.curiogarden.app.preview` | `curiogarden-preview` |
| E2E         | Curio Garden (E2E)     | `org.curiogarden.app.e2e`     | `curiogarden-e2e`     |
| Production  | Curio Garden           | `org.curiogarden.app`         | `curiogarden`         |

Development, preview, and E2E builds use separate identities and EAS internal
distribution, so automated installs cannot overwrite a human preview build.
Production beta distribution will use TestFlight and Google Play internal
testing. The native Library will initially require sign-in rather than creating
a second, device-local guest data model. EAS stores and automatically increments
production build numbers so consecutive beta submissions remain valid.

Minimum platform versions are iOS 16.4 and Android API 24. Android compiles and
targets API 36. The EAS profiles use the repository's current Node 24.16.0
patch, while the repository-wide contract remains Node 24 LTS.

## React resolution

The web lockfile resolves React and React DOM 19.2.8. Expo's SDK 57 template
still declares 19.2.3, while React Native 0.86.2 accepts `^19.2.3`. Downgrading
the production web application would discard later React fixes. The workspace
therefore resolves one React 19.2.8 runtime and explicitly excludes React,
React DOM, and the matching test renderer from Expo CLI's template-version
recommendations.

This exception is acceptable only while all of these gates remain green:

- `expo install --check`, with the exclusion reported explicitly;
- `expo-doctor`;
- `npm run mobile:check`, including a physical-install assertion for React,
  React DOM, React Native, and the SDK-pinned native runtime peers;
- clean iOS, Android, and EAS native builds;
- the complete web check, production build, and browser suites.

Metro aliases and duplicate React runtimes are not acceptable fallbacks.
`jest-expo` retains its SDK-pinned 19.2.3 renderer internally, while mobile's
direct React Native Testing Library renderer matches React 19.2.8. Both are
test-only; the application bundle contains neither renderer.

## Architecture and web-safety boundary

The root TypeScript, ESLint, and Vitest configurations exclude `mobile/`.
Mobile owns independent lint, TypeScript, Jest, Expo, and EAS configurations.
The root development manifest repeats the SDK-tested native peer versions only
to pin npm's hoisted workspace peer installations; architecture rules prevent
web production code from importing them, and they remain development-only.
`ts-archunit` still sees both platforms through separate TypeScript projects:

- web and Convex code may not import Expo, React Native, or `mobile/`;
- mobile code may not import Next.js, React DOM, web implementation folders,
  Clerk's Next.js SDK, or Convex server APIs;
- future platform-neutral behavior belongs in `packages/domain` only after both
  real applications need it.

The existing architecture baseline remains unchanged. New findings must be
fixed rather than added to the baseline.

Path-aware CI skips unrelated platform jobs only after a tested, fail-safe
classifier examines the candidate's full base-to-head diff. The classifier and
aggregate verifier execute from a separate checkout of the protected base
revision, never from code supplied by the pull request. Documentation link
validation remains selected for every change because Markdown may reference any
tracked local file. Shared manifests, Convex, shared packages, CI
infrastructure, unknown paths, and unreadable or empty diffs select the broader
safe gate set. The always-run `Required CI` aggregate rejects classifier
failures, malformed routes, selected jobs that were skipped, failures, and
cancellations while conditional jobs remain visible for diagnosis.

Classic branch protection cannot bind a status context to an immutable workflow
definition, so CodeRabbit remains an independent required check for workflow
changes. Privileged `pull_request_target` execution is intentionally prohibited:
these jobs install and execute candidate dependencies and tests.

## Accessibility and visual authority

The current web implementation, especially `app/globals.css` and current
components, is the visual source of truth. Older native art or theme guidance
may offer implementation patterns but cannot override the live site.

WCAG 2.2 AA, reflow at the largest text settings, reduced motion, and physical
device VoiceOver and TalkBack checks are release behavior. Automated tests
supplement those manual gates; they do not replace them. Results and blockers
are recorded in the
[native accessibility test matrix](../mobile-accessibility-test-matrix.md),
and a physical pass requires a signed build on named hardware.

## Explicitly deferred

Push notifications and every push-specific dependency, permission, credential,
schema, worker, and test are excluded. `eas.json` disables the EAS push setup
prompt.

Offline downloads and offline article storage are also excluded. They require a
separate product and security design for quotas, private media, account
switching, eviction, migrations, and article freshness.

Playlist work will retain Curio Garden's personal podcast RSS feed and provide
an accessible handoff to Apple Podcasts plus Android's app chooser/share/copy
fallback. Android has no single guaranteed system podcast application.

## Consequences

The repository has two intentionally separate UI toolchains and one shared
lockfile. Foundation changes carry a larger web regression gate, but product UI
can evolve without moving the production site or forcing DOM abstractions into
React Native. The first milestone is build reliability, not feature parity.

## References

- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
- [Expo monorepos](https://docs.expo.dev/guides/monorepos/)
- [EAS monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo app variants](https://docs.expo.dev/build-reference/variants/)
