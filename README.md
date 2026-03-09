# Curio Garden

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

**Audio** — Powered by Edge TTS with Microsoft's neural voices — free, high-quality audio with full seek, scrub, and download support. Generated audio is cached in Convex so each section only needs to be synthesized once. Long sections are chunked before synthesis to stay within Edge TTS limits while keeping startup latency low.

**Podcasts** — Curio Garden publishes multiple public RSS podcast feeds. The featured-article feed turns Wikipedia's featured article into a full listening session, and the trending-brief feed turns the daily AI-generated trend briefing into a podcast episode with episode-specific collage artwork.

**Discovery** — Search Wikipedia, browse today's Featured Article (with thumbnail), or tap "Surprise me" for a random article. A "What people are curious about" section highlights trending Wikipedia articles with thumbnails, so there's always something to explore. NSFW category filtering keeps random and trending results safe. After finishing an article, related articles are surfaced as "Listen next" suggestions.

**Trending briefing** — The Trending page can generate a daily AI-written audio briefing that summarizes why those articles are spiking and links out to recent news sources. The brief is generated once per trending date through Vercel AI Gateway, converted to speech, and cached in Convex.

**Article images** — Wikipedia thumbnails are displayed in article views with responsive layouts that adapt to portrait and landscape orientations. Images are prefetched for faster display. A Gallery section below the table of contents shows all images from the article with their captions in a card grid, with a keyboard-navigable lightbox for full-size viewing.

**Your library** — Recently listened articles appear on the home page. Save articles to your reading list with one tap and find them on the Library page. All persisted in your browser — no account needed.

**Accessibility** — Built from the ground up for WCAG 2.2 AA compliance: skip links, semantic landmarks, visible focus outlines, screen reader support with ARIA labels and live regions, full keyboard navigation, high-contrast text in light and dark modes, and color-independent status indicators.

**Installable** — Progressive Web App support with a manifest and service worker. Install Curio Garden to your home screen on any device for an app-like experience with faster repeat loads.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Backend/Data:** Convex (queries, mutations, actions, file storage) — optional, runs without it in local mode
- **TTS:** Edge TTS (free neural voices via Python `edge-tts`) with Convex-backed caching
- **AI:** Vercel AI Gateway via the AI SDK for daily trend brief generation and web search
- **Styling:** Tailwind CSS 4 + CSS custom properties
- **Fonts:** Fraunces (display), DM Sans (body), JetBrains Mono (code)
- **Testing:** Vitest

## Audio Architecture

Text is normalized before synthesis — stripping citation markers and expanding abbreviations (St. → Saint, Dr. → Doctor, etc.) for cleaner pronunciation.

**Edge TTS** provides free, high-quality neural voices from Microsoft via the Python [`edge-tts`](https://pypi.org/project/edge-tts/) package. Runs as a local Python process during development and as a Vercel Python serverless function in production. Default voice is `en-US-AriaNeural`. Produces MP3s with full seek, scrub, and download support. On Vercel, this works out of the box. For local development, see [Local Audio Setup](#local-audio-setup) below.

Generated audio is cached per-section in Convex file storage so each section is only synthesized once. Subsequent plays (by any user) are served directly from the cache.

Featured podcast episodes reuse that same section cache where possible, then concatenate the article into one stored MP3 for RSS delivery. Trending brief episodes are generated once per trending date, converted to speech, tagged with embedded collage artwork, and stored as podcast-ready MP3s. Vercel cron routes can generate both feeds on a schedule.

> **Note:** ElevenLabs integration was previously available but has been removed. It may return in a future update.

## Quick Start (Local Mode)

Try Curio Garden with zero setup — no accounts, no API keys, no backend:

```bash
npm install
npm run local
```

Open [http://localhost:3000](http://localhost:3000). You can browse, search, and navigate articles immediately. History, bookmarks, playback speed, and theme are persisted in localStorage.

Audio requires a one-time Python setup (takes 30 seconds) — see [Local Audio Setup](#local-audio-setup) below.

## Full Setup (with Convex)

For article caching, persistence, and audio caching:

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

## Local Audio Setup

Edge TTS uses Microsoft's neural voices via the Python [`edge-tts`](https://pypi.org/project/edge-tts/) package. On Vercel, this runs as a serverless function automatically — no setup needed.

For local development, you just need Python 3 installed. The venv is created automatically the first time you run `npm run dev:python` — no manual setup required. The venv lives at `.edge-tts-venv/` in the project root (gitignored) so it survives reboots.

If you want to run the standalone Python TTS server (useful for testing the Vercel function locally):

```bash
npm run dev:python
```

This starts Next.js, Convex, and a dedicated Python TTS server in parallel. Audio requests are rewritten to the Python server on port 3001.

### Customizing the Python path

If your Python environment is somewhere other than `.edge-tts-venv/`, set the `EDGE_TTS_PYTHON_PATH` environment variable:

```bash
EDGE_TTS_PYTHON_PATH=/path/to/your/python3 npm run local
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Production | Site URL for metadata, OpenGraph images, sitemap, and robots.txt (e.g. `https://curiogarden.org`) |
| `NEXT_PUBLIC_CONVEX_URL` | Convex mode | Convex deployment URL (auto-generated by `npx convex dev`) |
| `CONVEX_DEPLOYMENT` | Convex mode | Convex deployment identifier |
| `NEXT_PUBLIC_LOCAL_MODE` | No | Set to `"true"` to run without Convex |
| `USE_PYTHON_TTS` | No | Route `/api/tts` to the standalone Python TTS server (used by `npm run dev:python`) |
| `TTS_PORT` | No | Port for the standalone Python TTS server (default: `3001`) |
| `NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST` | No | Client-visible override for the per-request TTS chunk size limit, useful for forcing chunking locally |
| `TTS_MAX_WORDS_PER_REQUEST` | No | Server-side override for the per-request TTS chunk size limit; falls back to `NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST` |
| `CRON_SECRET` | No | Bearer token expected by the scheduled podcast cron routes and manual sync routes |
| `AI_GATEWAY_API_KEY` | No | Vercel AI Gateway API key used for the daily AI-generated trending brief |
| `TRENDING_BRIEF_MODEL` | No | Optional primary AI Gateway model override for the daily trending brief |
| `TRENDING_BRIEF_FALLBACK_MODEL` | No | Optional fallback AI Gateway model override for the daily trending brief |
| `EDGE_TTS_PYTHON_PATH` | No | Path to Python with `edge-tts` installed (default: `.edge-tts-venv/bin/python3`) |

See [`.env.example`](.env.example) for a copy-paste template with descriptions.

## Podcasts

Curio Garden can publish multiple public RSS feeds:

- Featured Articles: `/api/podcast/featured.xml`
- Trending Brief: `/api/podcast/trending.xml`

Featured Articles:

- Feed metadata makes it explicit that the article content comes from Wikipedia and is available under `CC BY-SA 4.0`.
- Each episode points at a stable enclosure URL under `/api/podcast/media/[episodeId]`, which redirects to the stored MP3 in Convex.
- `POST /api/podcast/featured/sync` is a manual trigger for generating the latest featured episode and is protected by `CRON_SECRET`.
- `GET /api/podcast/featured/cron` is the scheduled trigger used by Vercel cron and is protected by `CRON_SECRET`.

Trending Brief:

- Each episode points at a stable enclosure URL under `/api/podcast/media/trending/[briefId]`, which redirects to the stored MP3 in Convex.
- Each episode also gets local collage artwork generated from up to four trending-article thumbnails, with the trending date rendered into the image and embedded into the MP3 metadata.
- `POST /api/podcast/trending/sync` is a manual trigger for generating the latest trending brief episode and is protected by `CRON_SECRET`.
- `GET /api/podcast/trending/cron` is the scheduled trigger used by Vercel cron and is protected by `CRON_SECRET`.

To enable scheduled generation in production:

1. Set `CRON_SECRET` in Vercel project environment variables.
2. Deploy the app.
3. Vercel will call `/api/podcast/featured/cron` and `/api/podcast/trending/cron` using the schedules in `vercel.json`.

The default schedules are:

- `10 23 * * *` and `40 23 * * *` for the featured podcast (`23:10 UTC` primary run, `23:40 UTC` retry after Wikipedia rollover)
- `45 4 * * *` and `15 5 * * *` for the trending podcast (`04:45 UTC` primary run, `05:15 UTC` retry)

### Local podcast testing

With `npm run dev` running locally:

1. Generate the latest featured episode:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/podcast/featured/sync`
2. Generate the latest trending brief episode:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/podcast/trending/sync`
3. Inspect the feeds:
   `http://127.0.0.1:3000/api/podcast/featured.xml`
   `http://127.0.0.1:3000/api/podcast/trending.xml`
4. Inspect the podcast pages:
   `http://127.0.0.1:3000/podcasts`
   `http://127.0.0.1:3000/podcasts/featured`
   `http://127.0.0.1:3000/podcasts/trending`
5. Inspect the trending artwork:
   `http://127.0.0.1:3000/api/podcast/trending/artwork`

## Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js + Convex backend |
| `npm run dev:python` | Start Next.js + Convex + Python TTS server |
| `npm run local` | Local mode — no Convex, audio via local Python edge-tts |
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
  page.tsx                Landing page with search, featured article, trending, recently listened
  search/page.tsx         Search results page
  article/[slug]/page.tsx Article view with audio playback
  library/page.tsx        Saved reading list
  podcast/page.tsx        Redirects legacy /podcast to /podcasts
  podcasts/page.tsx       Public podcast index page for both feeds
  podcasts/[slug]/page.tsx Dedicated archive page for each podcast feed
  globals.css             Design system tokens, utilities, and component styles
  api/tts/route.ts        Edge TTS API route (local dev — shells out to Python)
  api/featured/route.ts   Featured article API route
  api/trending/brief/route.ts  Daily AI-generated trending briefing API route
  api/podcast/featured.xml/route.ts  RSS feed for featured podcast episodes
  api/podcast/featured/sync/route.ts Manual featured-episode generation trigger
  api/podcast/featured/cron/route.ts Scheduled featured-episode generation trigger
  api/podcast/trending.xml/route.ts  RSS feed for trending-brief podcast episodes
  api/podcast/trending/sync/route.ts Manual trending-brief generation trigger
  api/podcast/trending/cron/route.ts Scheduled trending-brief generation trigger
  api/podcast/media/[episodeId]/route.ts Stable podcast media URL
  api/podcast/media/trending/[briefId]/route.ts Stable trending podcast media URL
  api/podcast/trending/artwork/route.ts Latest trending podcast artwork
  api/podcast/trending/artwork/[briefId]/route.ts Episode-specific trending artwork

_python/
  tts.py                 Edge TTS serverless function (Vercel production)

requirements.txt         Python dependencies (edge-tts)

lib/
  data-context.tsx        DataContext type and useData() hook
  convex-data-provider.tsx  Convex implementation (wraps useAction hooks)
  local-data-provider.tsx   Local implementation (direct Wikipedia API calls)
  audio-prefetch.ts       Prefetches summary audio and article thumbnails
  featured-article.ts     Shared featured-article lookup helpers
  trending-brief.ts       AI Gateway + TTS pipeline for the daily trending briefing
  trending-podcast-artwork.ts  Collage artwork generator for trending podcast episodes
  podcast-directory.ts    Shared podcast-directory metadata and page formatting helpers
  podcast-episode.ts      Server-side featured podcast generation pipeline
  podcast-feed.ts         Shared RSS metadata and podcast description helpers
  podcast-rss.ts          Shared RSS XML formatting helpers
  tts-normalize.ts        Text normalization for TTS (abbreviation expansion)
  nsfw-filter.ts          Shared NSFW category/keyword filter and batch title check
  formatTime.ts           Duration formatting helpers

components/
  AccessibleLayout.tsx    Skip link, navbar, footer, landmark structure
  SearchForm.tsx          Accessible search form (GET /search?q=...)
  SearchResultsList.tsx   Wikipedia search results with loading/error states
  ArticleView.tsx         Article loader with audio playback, thumbnails, and resume
  ArticleGallery.tsx      Image gallery with captions extracted from article HTML
  ArticleHeader.tsx       Article metadata, links, license info
  AudioPlayer.tsx         File-based audio player with seek/scrub/download
  TableOfContents.tsx     Section list with per-section playback and Play All
  BookmarkButton.tsx      Save/unsave article to reading list
  BackButton.tsx          Navigation back button
  RecentlyListened.tsx    Recently listened articles grid (home page)
  FeaturedArticle.tsx     Today's Featured Article card with thumbnail (home page)
  CuriousAbout.tsx        Trending Wikipedia articles grid with thumbnails (home page)
  RandomArticleButton.tsx "Surprise me" button with NSFW category filter
  RelatedArticles.tsx     "Listen next" suggestions after playback
  LocalModeBanner.tsx     Dismissable banner shown in local mode
  ThemeProvider.tsx       Dark/light theme with useSyncExternalStore
  ThemeToggle.tsx         Theme toggle button (sun/moon icons)
  CopyFeedButton.tsx      Clipboard copy button for podcast feed URLs
  ServiceWorkerRegistration.tsx  Registers the PWA service worker

hooks/
  usePlaybackRate.ts      Persisted playback speed (0.5x–3x)
  useHistory.ts           Reading history with resume progress tracking
  useBookmarks.ts         Reading list / saved articles
  useAudioElement.ts      Shared HTML audio element management

convex/
  schema.ts              Database schema (articles, sectionAudio, podcast episodes/jobs)
  search.ts              Wikipedia search action
  articles.ts            Article query, upsert mutation, fetch-and-cache action
  audio.ts               Section audio caching (query, upload, save)
  trending.ts            Daily trending-brief queries and mutations
  podcast.ts             Featured podcast queries, mutations, and upload helpers
  lib/
    wikipedia.ts         Wikipedia REST/Action API client (also used by local mode)

scripts/
  build.sh               Vercel build script (production/preview/local)
  dev-tts.py             Local Python TTS dev server

public/
  manifest.json          PWA manifest
  sw.js                  Service worker (cache-first for assets, network-first for APIs)
  icon.svg               App icon
```

## Data Model

Primary Convex tables:

- `articles` stores cached Wikipedia article data used across search, article views, and podcast generation.
- `sectionAudio` stores per-section audio blobs keyed by article, section key, and TTS normalization version.
- `featuredPodcastEpisodes` stores one generated podcast episode per featured article date, including storage metadata and publication state.
- `featuredPodcastJobs` tracks scheduled/manual generation attempts and failures for the featured podcast pipeline.
- `trendingBriefs` stores one AI-generated, TTS-rendered daily briefing per Wikipedia trending date, including the podcast audio asset and the image URLs used to generate trending collage artwork.

## Accessibility

Curio Garden follows WCAG 2.2 AA guidelines:

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
