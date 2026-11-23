# Curio Garden accessibility and playback handoff

The home page leads with article search. Its listening sample lives in “How Curio Garden works.” On article pages, playback starts under the title, and the full summary is available through a disclosure. Now Playing stays available while the listener searches or opens another article. It keeps the article title visible when collapsed and adds the section name when space permits. Jump to section returns to the playing article and focuses its section control. The browser remembers the collapsed setting.

The home sample offers native audio controls while the page loads. The theme switch is in the site footer. The expanded player’s Keyboard shortcuts disclosure lists Space for play/pause, Left and Right Arrow for seeking ten seconds, and Shift+N for the next section during Play all. Listeners can turn those shortcuts off there.

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

- When new pageviews arrive before their narration, consider showing the latest published brief on Home and Trending with its own pageview date.
- Preserve the first publication timestamp across later episode edits. RSS currently uses the ready record's `updatedAt`, and the archive displays that same date in UTC.
