# Curio Garden accessibility and playback handoff

The home page leads with article search. Its listening sample lives in “How Curio Garden works.” On article pages, playback starts under the title, and the full summary is available through a disclosure. The Now Playing bar keeps controls available while scrolling through the article. Minimize keeps the section title and play/pause within reach. The browser remembers that preference.

## Conventions for future changes

- Use Atkinson Hyperlegible Next for reading and controls. Reserve Fraunces for display headings. Reading text starts at 16px, interactive labels at 14px, and incidental metadata at 12px.
- Keep standalone controls at least 44px tall. Use sentence-case labels and color tokens for secondary text. Keep the visible label in each control’s accessible name.
- Preserve keyboard focus during playback. Account for the current player height when positioning the download tray or scrolling to a section.
- Keep image attribution available through the image credit disclosure. For shared buttons, set sizes in the component or in the unlayered CSS that owns them.
- Check narrow layouts at 320 CSS pixels with enlarged text. A page can fit at the default phone viewport and still clip a control or dialog at this width.

## Verification

Use the Node version selected by `.nvmrc`. The public Playwright suite runs in local mode, with Chromium, Android text scaling, and WebKit with simulated iOS text sizes. The authenticated suite uses a Clerk development account and test keys. If another Next dev server is running in the same project, run the suite in a separate checkout.

```sh
npm run check
npm run test:e2e -- --workers=2
npm run test:e2e:auth -- --workers=1
```

The [search accessibility matrix](../search-accessibility-test-matrix.md) records manual assistive-technology scenarios. The [trending generation guide](../trending-podcast-generation.md) explains how to distinguish a delayed publication from the normal interval between a new pageview snapshot and the narration job.

## Follow-up work

- Keep article audio playing when the listener navigates to another route. This needs a playback owner that survives article unmounts and a way to return to the playing section.
- Design and document keyboard shortcuts for play/pause, seeking, and skipping a section. Preserve native typing, scrolling, and focused control behavior.
- Revisit theme toggle placement separately from playback.
