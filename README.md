# World Garden

![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Convex](https://img.shields.io/badge/Convex-1.32-F3694C?logo=convex&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![WCAG 2.2 AA](https://img.shields.io/badge/WCAG_2.2-AA-green?logo=accessibility&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

Your Wikipedia listening library — an accessibility-first web app that turns Wikipedia articles into structured, navigable audio you can listen to right in your browser.

## Features

**Audio playback** — Listen to any Wikipedia article section by section. Play a single section, or hit Play All for the full lean-back experience with automatic progression. Adjustable speed from 0.5× to 3×, with your preference saved between sessions. Resume from where you left off when you return to an article.

**Discovery** — Search Wikipedia, browse today's Featured Article, or tap "Surprise me" for a random article (with an NSFW category filter so you get something safe). After finishing an article, related articles are surfaced as "Listen next" suggestions.

**Your library** — Recently listened articles appear on the home page. Save articles to your reading list with one tap and find them on the Library page. All persisted in your browser — no account needed.

**High-quality voices** — By default, World Garden uses your browser's built-in speech engine (zero cost, no API keys). For higher quality, add your own ElevenLabs API key in Settings — audio is generated client-side with full seek, scrub, and download support. Your key stays in your browser and is never sent to our servers.

**Accessibility** — Built from the ground up for WCAG 2.2 AA compliance: skip links, semantic landmarks, visible focus outlines, screen reader support with ARIA labels and live regions, full keyboard navigation, high-contrast text in light and dark modes, and color-independent status indicators.

**Installable** — Progressive Web App support with a manifest and service worker. Install World Garden to your home screen on any device for an app-like experience with faster repeat loads.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Backend/Data:** Convex (queries, mutations, actions, file storage) — optional, runs without it in local mode
- **TTS:** Browser SpeechSynthesis API (default) or ElevenLabs (bring your own API key)
- **Styling:** Tailwind CSS 4 + CSS custom properties
- **Fonts:** Fraunces (display), DM Sans (body), JetBrains Mono (code)
- **Testing:** Vitest

## Audio Architecture

World Garden has a two-tier audio system:

1. **Browser SpeechSynthesis (default):** Zero cost, no API keys, instant playback. Text is cleaned of citation markers and abbreviations are expanded for better pronunciation. Long text is chunked into sentences to work around Chrome's ~15-second limit. Voice quality varies by browser and OS.

2. **ElevenLabs (opt-in):** Open the Settings panel (gear icon in the navbar) and enter your ElevenLabs API key. Audio is generated client-side — your key never leaves your browser. Produces downloadable MP3s with full seek/scrub support via the `AudioPlayer` component. The Convex codebase also contains a server-side TTS pipeline (`convex/audio.ts`, `convex/lib/elevenlabs.ts`) for future hosted generation with caching.

## Quick Start (Local Mode)

Try World Garden with zero setup — no accounts, no API keys, no backend:

```bash
npm install
npm run local
```

Open [http://localhost:3000](http://localhost:3000). Articles are fetched live from Wikipedia and read aloud using your browser's built-in speech engine. History, bookmarks, playback speed, and theme are persisted in localStorage.

## Full Setup (with Convex)

For article caching, persistence, and future server-side TTS support:

### Prerequisites

- Node.js 18+
- A [Convex](https://convex.dev) account

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Convex

Run the Convex dev server to create a deployment and generate types:

```bash
npx convex dev
```

This will prompt you to create a new project. Once set up, it writes `NEXT_PUBLIC_CONVEX_URL` to your `.env.local`.

### 3. Run the development server

```bash
npm run dev
```

This starts both the Next.js frontend and the Convex backend in parallel.

- Frontend: [http://localhost:3000](http://localhost:3000)
- Convex dashboard: [https://dashboard.convex.dev](https://dashboard.convex.dev)

## Project Structure

```
app/
  layout.tsx              Root layout with providers, PWA meta, and accessibility shell
  AppProviders.tsx        Switches between Convex and local data providers
  page.tsx                Landing page with search, recently listened, featured article
  search/page.tsx         Search results page
  article/[slug]/page.tsx Article view with audio playback
  library/page.tsx        Saved reading list
  globals.css             Design system tokens, utilities, and component styles

lib/
  data-context.tsx        DataContext type and useData() hook
  convex-data-provider.tsx  Convex implementation (wraps useAction hooks)
  local-data-provider.tsx   Local implementation (direct Wikipedia API calls)

components/
  AccessibleLayout.tsx    Skip link, navbar, footer, landmark structure
  SearchForm.tsx          Accessible search form (GET /search?q=...)
  SearchResultsList.tsx   Wikipedia search results with loading/error states
  ArticleView.tsx         Article loader with audio playback, resume, and bookmarks
  ArticleHeader.tsx       Article metadata, links, license info
  BrowserTtsPlayer.tsx    SpeechSynthesis-based audio player (default)
  AudioPlayer.tsx         File-based audio player with seek/download (ElevenLabs)
  TableOfContents.tsx     Section list with per-section playback and Play All
  BookmarkButton.tsx      Save/unsave article to reading list
  RecentlyListened.tsx    Recently listened articles grid (home page)
  FeaturedArticle.tsx     Today's Featured Article card (home page)
  RandomArticleButton.tsx "Surprise me" button with NSFW category filter
  RelatedArticles.tsx     "Listen next" suggestions after playback
  SettingsPanel.tsx       ElevenLabs API key and voice settings
  LocalModeBanner.tsx     Dismissable banner shown in local mode
  ThemeProvider.tsx       Dark/light theme with useSyncExternalStore
  ThemeToggle.tsx         Theme toggle button (sun/moon icons)
  ServiceWorkerRegistration.tsx  Registers the PWA service worker

hooks/
  usePlaybackRate.ts      Persisted playback speed (0.5x–3x)
  useHistory.ts           Reading history with resume progress tracking
  useBookmarks.ts         Reading list / saved articles
  useElevenLabsSettings.ts  ElevenLabs API key and voice ID (localStorage)

convex/
  schema.ts              Database schema (articles, sectionAudio, rateLimits)
  search.ts              Wikipedia search action
  articles.ts            Article query, upsert mutation, fetch-and-cache action
  audio.ts               Audio caching layer (server-side TTS path)
  lib/
    wikipedia.ts         Wikipedia REST/Action API client (also used by local mode)
    elevenlabs.ts        ElevenLabs TTS client and text normalization

public/
  manifest.json          PWA manifest
  sw.js                  Service worker (cache-first for assets, network-first for APIs)
  icon.svg               App icon
```

## Accessibility

World Garden follows WCAG 2.2 AA guidelines:

- **Skip link** to main content
- **Semantic landmarks:** `<header>`, `<main>`, `<footer>`, `<nav>`, `<article>`, `<time>`
- **Visible focus outlines** on all interactive elements
- **Screen reader support:** ARIA labels, live regions for status updates, state-aware toggle labels, descriptive button and link labels, and "(opens in new tab)" on external links
- **Keyboard navigation:** All flows work without a mouse; dialogs trap focus and restore it on close
- **High contrast:** All text meets AA contrast ratios in both light and dark modes
- **Color independence:** Status indicators use text, not just color
- **Reduced motion:** `prefers-reduced-motion` media query disables decorative animations

## License

This project's source code is licensed under the [MIT License](LICENSE).

Article content displayed by this app is sourced from Wikipedia and is available under the [Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/). See [Wikipedia's Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) for details.

## Contributing

Contributions are welcome! Please read the [contributing guide](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md) before opening issues or pull requests.
