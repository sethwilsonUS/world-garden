# Contributing to World Garden

Thanks for your interest in contributing! World Garden is an accessibility-first Wikipedia audio reader, and we take that "accessibility-first" part seriously. Every contribution should maintain or improve the experience for all users, including those using screen readers, keyboard navigation, or other assistive technologies.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Getting Started

1. Fork the repository and clone your fork:

```bash
git clone https://github.com/<your-username>/world-garden.git
cd world-garden
npm install
```

2. Run in local mode (no accounts or API keys needed):

```bash
npm run local
```

3. Or run with Convex for full functionality:

```bash
npx convex dev   # first-time setup — creates a project and writes .env.local
npm run dev       # starts Next.js + Convex in parallel
```

## Development Workflow

1. Create a branch from `main`:

```bash
git checkout -b feat/your-feature
```

2. Make your changes, ensuring tests pass:

```bash
npm test
npm run lint
```

3. Commit with a clear message describing _what_ and _why_:

```bash
git commit -m "Add voice selection dropdown to TTS player"
```

4. Push your branch and open a pull request against `main`.

### Branch Naming

| Prefix     | Use for                        |
|------------|--------------------------------|
| `feat/`    | New features                   |
| `fix/`     | Bug fixes                      |
| `a11y/`    | Accessibility improvements     |
| `refactor/`| Code restructuring             |
| `docs/`    | Documentation changes          |
| `test/`    | Adding or updating tests       |

## Code Style

- **TypeScript** everywhere — no `any` unless absolutely necessary and documented.
- **ESLint** config is in `eslint.config.mjs`. Run `npm run lint` before committing.
- **Tailwind CSS 4** for styling. Use the existing design tokens in `app/globals.css` rather than hardcoded values.
- **Semantic HTML** over ARIA when possible (`<button>` not `<div role="button">`).
- Keep components focused. If a file grows past ~300 lines, consider splitting it.

## Accessibility Requirements

All contributions must maintain WCAG 2.2 AA compliance. Before submitting a PR, verify:

- [ ] **Keyboard navigation** — every interactive element is reachable and operable with the keyboard alone.
- [ ] **Focus management** — focus moves logically after actions (e.g., opening a modal, navigating to a new view). Focus is never lost.
- [ ] **Screen reader testing** — test with at least one screen reader (VoiceOver on macOS, NVDA on Windows). Announcements should be clear and timely.
- [ ] **ARIA attributes** — labels, live regions, and roles are correct and present where needed.
- [ ] **Color contrast** — all text meets AA contrast ratios (4.5:1 for normal text, 3:1 for large text) in both light and dark modes.
- [ ] **Color independence** — information is never conveyed by color alone.
- [ ] **Motion** — respect `prefers-reduced-motion`. No essential information is conveyed only through animation.

If your change adds a new interactive component, include a brief note in the PR describing how it behaves for keyboard and screen reader users.

## Testing

We use [Vitest](https://vitest.dev/) for testing:

```bash
npm test            # run all tests once
npm run test:watch  # re-run on file changes
```

When adding new functionality, include tests that cover:

- Core logic and edge cases
- Error states and loading states
- Accessibility-relevant behavior (e.g., ARIA attribute values, keyboard interactions)

Test files live alongside the code they test (e.g., `components/TableOfContents.test.ts`).

## Wikipedia Content

Article content displayed by World Garden is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). If your change touches how article content is displayed, make sure:

- Attribution to Wikipedia remains visible.
- Links to the original article and license are preserved.
- The license footer in `ArticleHeader.tsx` is not removed or obscured.

## Reporting Issues

When opening an issue, please include:

- Steps to reproduce the problem
- Expected vs. actual behavior
- Browser, OS, and any assistive technology in use
- Screenshots or screen recordings if applicable

For accessibility issues, please tag the issue with `a11y`.

## Questions?

Open a [discussion](https://github.com/sethwilsonUS/world-garden/discussions) or reach out in an issue. We're happy to help you get started.
