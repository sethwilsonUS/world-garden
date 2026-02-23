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

**Audio playback** — Listen to any Wikipedia article section by section. Play a single section, or hit Play All for the full lean-back experience with automatic progression. Adjustable speed from 0.5× to 3×, with your preference saved between sessions. Resume from where you left off when you return to an article. Download full articles as MP3 for offline listening.

**Three-tier TTS** — Choose the voice engine that fits your needs. **Edge TTS** (default when set up) uses Microsoft's neural voices for free, high-quality audio with full seek, scrub, and download support. **Browser SpeechSynthesis** works out of the box with zero setup. **ElevenLabs** (bring your own API key) offers premium voices — your key stays in your browser and is never sent to our servers.

**Discovery** — Search Wikipedia, browse today's Featured Article, or tap "Surprise me" for a random article (with an NSFW category filter so you get something safe). After finishing an article, related articles are surfaced as "Listen next" suggestions.

**Article images** — Wikipedia thumbnails are displayed in article views with responsive layouts that adapt to portrait and landscape orientations. Images are prefetched for faster display.

**Your library** — Recently listened articles appear on the home page. Save articles to your reading list with one tap and find them on the Library page. All persisted in your browser — no account needed.

**Accessibility** — Built from the ground up for WCAG 2.2 AA compliance: skip links, semantic landmarks, visible focus outlines, screen reader support with ARIA labels and live regions, full keyboard navigation, high-contrast text in light and dark modes, and color-independent status indicators.

**Installable** — Progressive Web App support with a manifest and service worker. Install World Garden to your home screen on any device for an app-like experience with faster repeat loads.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Backend/Data:** Convex (queries, mutations, actions, file storage) — optional, runs without it in local mode
- **TTS:** Edge TTS (free neural voices via Python `edge-tts`), Browser SpeechSynthesis (zero-setup fallback), or ElevenLabs (bring your own API key)
- **Styling:** Tailwind CSS 4 + CSS custom properties
- **Fonts:** Fraunces (display), DM Sans (body), JetBrains Mono (code)
- **Testing:** Vitest

## Audio Architecture

World Garden has a three-tier audio system. All tiers normalize text before synthesis — stripping citation markers and expanding abbreviations (St. → Saint, Dr. → Doctor, etc.) for cleaner pronunciation.

1. **Edge TTS (recommended):** Free, high-quality neural voices from Microsoft via the Python [`edge-tts`](https://pypi.org/project/edge-tts/) package. Runs as a local Python process during development and as a Vercel Python serverless function in production. Default voice is `en-US-AriaNeural`. Produces MP3s with full seek, scrub, and download support. Requires a one-time Python setup (see [Edge TTS Setup](#edge-tts-setup-optional) below).

2. **Browser SpeechSynthesis (zero-setup fallback):** Uses your browser's built-in speech engine — no API keys, no setup. Long text is chunked into sentences to work around Chrome's ~15-second limit. Voice quality varies by browser and OS.

3. **ElevenLabs (premium, opt-in):** Open the Settings panel (gear icon in the navbar) and enter your ElevenLabs API key. Audio is generated client-side — your key never leaves your browser. Produces downloadable MP3s with full seek/scrub support. The Convex backend also contains a server-side TTS pipeline (`convex/audio.ts`, `convex/lib/elevenlabs.ts`) for hosted generation with caching.

## Quick Start (Local Mode)

Try World Garden with zero setup — no accounts, no API keys, no backend:

```bash
npm install
npm run local
```

Open [http://localhost:3000](http://localhost:3000). Articles are fetched live from Wikipedia and read aloud using your browser's built-in speech engine. History, bookmarks, playback speed, and theme are persisted in localStorage.

For better audio quality, set up [Edge TTS](#edge-tts-setup-optional) (free, takes 30 seconds).

## Full Setup (with Convex)

For article caching, persistence, and server-side TTS with caching:

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

## Edge TTS Setup (Optional)

For higher-quality audio than Browser SpeechSynthesis (free, no API key needed):

```bash
python3 -m venv /tmp/edge-tts-venv
/tmp/edge-tts-venv/bin/pip install edge-tts
```

Then start the dev server with Edge TTS enabled:

```bash
npm run dev:python
```

This starts Next.js, Convex, and a local Python TTS server in parallel. Audio requests are routed to the Python process, which generates MP3s using Microsoft's neural voices.

On Vercel, Edge TTS runs as a Python serverless function at `/api/tts` — no extra setup needed for production deployments.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex mode | Convex deployment URL (auto-generated by `npx convex dev`) |
| `CONVEX_DEPLOYMENT` | Convex mode | Convex deployment identifier |
| `NEXT_PUBLIC_LOCAL_MODE` | No | Set to `"true"` to run without Convex |
| `USE_PYTHON_TTS` | No | Enable Python TTS route rewriting in local dev |
| `TTS_PORT` | No | Port for the Python TTS dev server (default: `3001`) |
| `EDGE_TTS_PYTHON_PATH` | No | Path to Python with `edge-tts` installed (default: `/tmp/edge-tts-venv/bin/python3`) |

**Convex dashboard variables** (for server-side ElevenLabs TTS):

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Default ElevenLabs voice ID |

## Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js + Convex backend |
| `npm run dev:python` | Start Next.js + Convex + Python TTS server |
| `npm run local` | Local mode — no Convex, browser TTS only |
| `npm run build` | Production build (handles Vercel environments) |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Watch mode tests |
| `npm run lint` | ESLint |

## Project Structure

```
app/
  layout.tsx              Root layout with providers, PWA meta, and accessibility shell
  AppProviders.tsx        Switches between Convex and local data providers
  ConvexClientProvider.tsx  Convex client wrapper
  page.tsx                Landing page with search, recently listened, featured article
  search/page.tsx         Search results page
  article/[slug]/page.tsx Article view with audio playback
  library/page.tsx        Saved reading list
  globals.css             Design system tokens, utilities, and component styles
  api/tts/route.ts        Edge TTS API route (local dev — shells out to Python)

api/
  tts.py                 Edge TTS serverless function (Vercel production)
  requirements.txt       Python dependencies (edge-tts)

lib/
  data-context.tsx        DataContext type and useData() hook
  convex-data-provider.tsx  Convex implementation (wraps useAction hooks)
  local-data-provider.tsx   Local implementation (direct Wikipedia API calls)
  audio-prefetch.ts       Prefetches summary audio and article thumbnails
  formatTime.ts           Duration formatting helpers

components/
  AccessibleLayout.tsx    Skip link, navbar, footer, landmark structure
  SearchForm.tsx          Accessible search form (GET /search?q=...)
  SearchResultsList.tsx   Wikipedia search results with loading/error states
  ArticleView.tsx         Article loader with audio playback, thumbnails, and resume
  ArticleHeader.tsx       Article metadata, links, license info
  AudioPlayer.tsx         File-based audio player with seek/scrub/download
  SummaryPlayer.tsx       Inline player for article summary audio
  GenerateAudioButton.tsx One-tap audio generation trigger
  TableOfContents.tsx     Section list with per-section playback and Play All
  BookmarkButton.tsx      Save/unsave article to reading list
  BackButton.tsx          Navigation back button
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
  useAudioElement.ts      Shared HTML audio element management

convex/
  schema.ts              Database schema (articles, sectionAudio, rateLimits)
  search.ts              Wikipedia search action
  articles.ts            Article query, upsert mutation, fetch-and-cache action
  audio.ts               Audio caching layer (server-side TTS path)
  lib/
    wikipedia.ts         Wikipedia REST/Action API client (also used by local mode)
    elevenlabs.ts        ElevenLabs TTS client and text normalization
    rateLimiter.ts       Sliding-window rate limiting

scripts/
  build.sh               Vercel build script (production/preview/local)
  dev-tts.py             Local Python TTS dev server

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
