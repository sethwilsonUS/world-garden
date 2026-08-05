## Summary

<!-- What does this PR do and why? -->

## Accessibility

- [ ] Keyboard, focus, screen-reader, contrast, and reduced-motion behavior was verified for changed UI
- [ ] Playwright/axe coverage was added or updated for accessibility-relevant behavior
- [ ] Not applicable — this PR does not change rendered UI (explain in the summary)

### Native UI changes

- [ ] `npm run mobile:check` passes
- [ ] Physical iOS VoiceOver evidence was updated
- [ ] Physical Android TalkBack evidence was updated
- [ ] Maximum text/display-size evidence was updated
- [ ] Not applicable, blocked, or not run — explain every unchecked physical gate in the summary; automation is not a substitute

## Testing

- [ ] `npm run check` passes (ESLint, TypeScript, architecture rules, and all Vitest tests)
- [ ] `npm run docs:check` passes
- [ ] `LOCAL_MODE=true NEXT_PUBLIC_LOCAL_MODE=true npm run build` passes
- [ ] `npm run test:e2e` passes for UI changes
- [ ] Python import validation and `python -m ruff check _python/` pass for Python changes
- [ ] New logic has corresponding unit tests
- [ ] Manual verification is described above, or is not applicable
