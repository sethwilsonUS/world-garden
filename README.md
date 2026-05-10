# Curio Garden

![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Convex](https://img.shields.io/badge/Convex-1.32-F3694C?logo=convex&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![WCAG 2.2 AA](https://img.shields.io/badge/WCAG_2.2-AA-green?logo=accessibility&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

Your Wikipedia listening library and personal podcast queue — an accessibility-first web app that turns Wikipedia articles into structured, navigable audio you can listen to right in your browser or follow in your podcast app.

## Features

**Audio playback** — Listen to any Wikipedia article section by section. Play a single section, or hit Play All for the full lean-back experience with automatic progression. Adjustable speed from 0.5× to 3×, with your preference saved between sessions. Resume from where you left off when you return to an article. Download full articles as MP3 for offline listening.

**Audio** — Powered by OpenAI `gpt-4o-mini-tts` with Microsoft Edge TTS fallback. Generated synthetic speech is cached in Convex by provider, model, voice, prompt version, and normalization version so narration changes can regenerate cleanly without breaking existing audio.

**Podcasts** — Curio Garden publishes multiple RSS podcast feeds. The featured-article feed turns Wikipedia's featured article into a full listening session, the trending-brief feed turns the daily AI-generated trend briefing into a podcast episode with episode-specific collage artwork, and signed-in users get a private-by-token personal playlist feed that mirrors their dashboard queue.

**Discovery** — Search Wikipedia, browse today's Featured Article (with thumbnail), or tap "Surprise me" for a random article. A cron-cached "Today on Wikipedia" section gathers the full Did You Know list, editor-curated In the News items, an accessible Picture of the Day with cached spoken description audio, a small On This Day entry, and a compact Trending teaser. The dedicated Trending page keeps the full pageview-driven list and daily audio brief. NSFW category filtering keeps random and trending results safe. After finishing an article, related articles are surfaced as "Listen next" suggestions.

**Trending briefing** — The Trending page can generate a daily AI-written audio briefing that summarizes why those articles are spiking and links out to recent news sources. The brief text is generated once per trending date through Vercel AI Gateway, converted to synthetic speech, and cached in Convex.

**Article images** — Wikipedia thumbnails are displayed in article views with responsive layouts that adapt to portrait and landscape orientations. Images are prefetched for faster display. A Gallery section below the table of contents shows all images from the article with their captions in a card grid, with a keyboard-navigable lightbox for full-size viewing.

**Accounts and dashboard** — Clerk sign-in unlocks a dashboard with a synced library, a personal playlist queue, copyable RSS feed URLs, and queue management controls for moving, removing, and retrying generated episodes. Guests can still explore freely and keep a device-local library without creating an account.

**Your library** — Recently listened articles appear on the home page. Save articles to your reading list with one tap and find them on the Library page. Guests keep bookmarks on the current device, while signed-in readers get a synced library across sessions.

**Personal playlist** — Add an article to your playlist while browsing to queue a full-article MP3 for background generation. Playlist is intentionally separate from Library: Library is for keeping things around, Playlist is for sequencing what should play next in your personal podcast feed.

**Accessibility** — Built from the ground up for WCAG 2.2 AA compliance: skip links, semantic landmarks, visible focus outlines, screen reader support with ARIA labels and live regions, full keyboard navigation, high-contrast text in light and dark modes, and color-independent status indicators.

**Installable** — Progressive Web App support with a manifest and service worker. Install Curio Garden to your home screen on any device for an app-like experience with faster repeat loads.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Backend/Data:** Convex (queries, mutations, actions, file storage) — optional, runs without it in local mode
- **Auth:** Clerk for sign-in and account sessions, bridged into Convex auth for viewer-scoped data
- **TTS:** OpenAI `gpt-4o-mini-tts` primary with Edge TTS fallback and Convex-backed variant caching
- **AI:** Vercel AI Gateway via the AI SDK for daily trend brief generation and web search
- **Styling:** Tailwind CSS 4 + CSS custom properties
- **Fonts:** Fraunces (display), DM Sans (body), JetBrains Mono (code)
- **Testing:** Vitest

## Audio Architecture

Text is normalized before synthesis — stripping citation markers and expanding abbreviations (St. → Saint, Dr. → Doctor, etc.) for cleaner pronunciation.

**OpenAI TTS** is the canonical provider for `/api/tts`, using direct `POST https://api.openai.com/v1/audio/speech`, model `gpt-4o-mini-tts`, voice `marin`, and prompt version `curio-warm-narrator-v1`. The Vercel AI Gateway remains the text-generation path, but the current Gateway probe did not expose `/v1/audio/speech` or `gpt-4o-mini-tts` speech models, so speech generation calls OpenAI directly.

**Edge TTS fallback** remains available through `/api/tts/edge` using Microsoft's neural voices via the Python [`edge-tts`](https://pypi.org/project/edge-tts/) package. Default fallback voice is `en-US-AriaNeural`. If OpenAI fails and fallback is enabled, generation retries with Edge and records the resulting Edge provider metadata.

Generated audio is cached per-section in Convex file storage by `tts:${provider}:${model}:${voice}:${promptVersion}:${TTS_NORM_VERSION}`. Changing normalization or narration prompt versions should change the cache key and regenerate audio on demand.

Featured podcast episodes and personal playlist episodes both reuse that same section cache where possible, then run through the shared full-article assembly pipeline used by Download All before storing a podcast-ready MP3. Trending brief episodes are generated once per trending date, converted to speech, tagged with embedded collage artwork, and stored as podcast-ready MP3s. Picture of the Day descriptions are generated once per featured-feed date and cached in Convex storage so the first listener gets ready audio. Vercel cron routes can generate the public feeds on a schedule.

> **Note:** ElevenLabs integration was previously available but has been removed. It may return in a future update.

## Quick Start (Local Mode)

Try Curio Garden with zero setup for browsing and discovery — no accounts or backend required:

```bash
npm install
npm run local
```

Open [http://localhost:3000](http://localhost:3000). You can browse, search, and navigate articles immediately. History, bookmarks, playback speed, and theme are persisted in localStorage.

Local mode skips Clerk and Convex entirely, so account-only features such as the synced dashboard, personal playlist, and personal RSS feed are intentionally unavailable there.

Audio features require `OPENAI_API_KEY` for the primary provider, or the one-time Python setup for local Edge fallback testing — see [Local Audio Setup](#local-audio-setup) below.

## Full Setup (with Convex)

For article caching, synced accounts, personal playlist feeds, and audio caching:

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

### 3. Connect Clerk to Next.js and Convex

Clerk can boot in keyless mode for a quick local smoke test, so you do not need keys before the first run. After the app opens:

1. Sign up from the header.
2. If Clerk shows a `Configure your application` callout, click it to claim the generated instance.
3. In the Clerk dashboard, open `Convex integration setup` and enable it.
4. If your dashboard shows the older auth flow instead, open `JWT templates`, create a `Convex` template, and use that issuer value instead.
5. Copy the Clerk `Frontend API URL`. Convex uses that value as `CLERK_JWT_ISSUER_DOMAIN`.
6. In `API keys`, copy the publishable key and secret key into `.env.local` and your Vercel project.

This auth bridge powers all signed-in viewer features: the synced Library, the Dashboard, and the per-user Personal Playlist RSS feed.

In the Convex dashboard for your deployment:

1. Open the current deployment.
2. Add `CLERK_JWT_ISSUER_DOMAIN` with the Clerk Frontend API URL.
3. Run `npx convex dev` again so `convex/auth.config.ts` is pushed with the updated issuer.

For production, repeat the same setup with your production Clerk environment and production Convex deployment, then run:

```bash
npx convex deploy
```

### 4. Run the development server

```bash
npm run dev
```

This starts both the Next.js frontend and the Convex backend in parallel.

- Frontend: [http://localhost:3000](http://localhost:3000)
- Convex dashboard: [https://dashboard.convex.dev](https://dashboard.convex.dev)

## Local Audio Setup

Edge fallback uses Microsoft's neural voices via the Python [`edge-tts`](https://pypi.org/project/edge-tts/) package. On Vercel, this runs as a serverless function automatically behind `/api/tts/edge`.

For local development, you just need Python 3 installed. The venv is created automatically the first time you run `npm run dev:python` — no manual setup required. The venv lives at `.edge-tts-venv/` in the project root (gitignored) so it survives reboots.

If you want to run the standalone Python TTS server (useful for testing the Vercel function locally):

```bash
npm run dev:python
```

This starts Next.js, Convex, and a dedicated Python TTS server in parallel. Edge fallback requests at `/api/tts/edge` are rewritten to the Python server on port 3001.

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
| `CLERK_JWT_ISSUER_DOMAIN` | Convex mode | Clerk Frontend API URL configured in the Convex dashboard for JWT verification |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | No | Clerk publishable key for a claimed local/prod app; required for sign-in, dashboard, and playlist features once you move past keyless local boot |
| `CLERK_SECRET_KEY` | No | Clerk secret key for a claimed local/prod app; required for sign-in, dashboard, and playlist features in local/prod environments |
| `NEXT_PUBLIC_LOCAL_MODE` | No | Set to `"true"` to run without Convex |
| `TTS_PRIMARY_PROVIDER` | No | Primary speech provider for `/api/tts`; defaults to `openai` |
| `OPENAI_API_KEY` | Yes for OpenAI TTS | Direct OpenAI API key for `/v1/audio/speech` |
| `OPENAI_TTS_MODEL` | No | OpenAI speech model; defaults to `gpt-4o-mini-tts` |
| `OPENAI_TTS_VOICE` | No | OpenAI voice; defaults to `marin` |
| `OPENAI_TTS_PROMPT_VERSION` | No | Cache-busting narration prompt version; defaults to `curio-warm-narrator-v1` |
| `OPENAI_TTS_INSTRUCTIONS` | No | Optional narration instructions sent with OpenAI speech requests |
| `TTS_EDGE_FALLBACK` | No | Set to `"false"` to disable automatic Edge fallback after OpenAI failures |
| `EDGE_TTS_VOICE_ID` | No | Edge fallback voice; defaults to `en-US-AriaNeural` |
| `TTS_PUBLIC_OPENAI_BURST_LIMIT` | No | Public OpenAI TTS burst quota per IP; defaults to `120` requests |
| `TTS_PUBLIC_OPENAI_BURST_WINDOW_MS` | No | Public OpenAI TTS burst window; defaults to `600000` ms |
| `TTS_PUBLIC_OPENAI_DAILY_LIMIT` | No | Public OpenAI TTS daily quota per IP; defaults to `800` requests |
| `TTS_PUBLIC_OPENAI_DAILY_WINDOW_MS` | No | Public OpenAI TTS daily window; defaults to `86400000` ms |
| `TTS_QUOTA_BYPASS_SECRET` | No | Shared secret for trusted server TTS generation to bypass public visitor quotas; set in both Vercel and Convex |
| `USE_PYTHON_TTS` | No | Route `/api/tts/edge` to the standalone Python TTS server (used by `npm run dev:python`) |
| `TTS_PORT` | No | Port for the standalone Python TTS server (default: `3001`) |
| `NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST` | No | Client-visible override for the per-request TTS chunk size limit, useful for forcing chunking locally |
| `TTS_MAX_WORDS_PER_REQUEST` | No | Server-side override for the per-request TTS chunk size limit; falls back to `NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST` |
| `CRON_SECRET` | No | Bearer token expected by the scheduled podcast cron routes and manual sync routes |
| `AI_GATEWAY_API_KEY` | No | Vercel AI Gateway API key used for the daily AI-generated trending brief |
| `TRENDING_BRIEF_MODEL` | No | Optional primary AI Gateway model override for the daily trending brief |
| `TRENDING_BRIEF_FALLBACK_MODEL` | No | Optional fallback AI Gateway model override for the daily trending brief |
| `EDGE_TTS_PYTHON_PATH` | No | Path to Python with `edge-tts` installed (default: `.edge-tts-venv/bin/python3`) |

See [`.env.example`](.env.example) for a copy-paste template with descriptions.

## Traffic Spike Runbook

Curio Garden is designed to keep browsing cheap and cacheable; the main spike risk is first-time OpenAI TTS generation. Public OpenAI TTS requests are protected by generous per-IP quotas, and over-quota requests automatically use the Edge fallback voice so playback keeps working.

Before a boost or public post:

1. Top up OpenAI credits and confirm project budget alerts.
2. Confirm `OPENAI_API_KEY`, `TTS_EDGE_FALLBACK=true`, and `EDGE_TTS_VOICE_ID` are set in Vercel.
3. Confirm `TTS_QUOTA_BYPASS_SECRET` is set to the same value in Vercel and Convex so trusted server generation bypasses public quotas.
4. Confirm the quota defaults are acceptable: `120` requests per `10` minutes and `800` requests per `24` hours per IP.

During the spike:

1. Watch OpenAI usage and rate-limit dashboards.
2. Watch Vercel logs and Analytics for `TTS Route` events, especially `fallbackReason=openai_quota`.
3. Watch Convex storage, egress, function calls, and quota mutation health.
4. Check user reports for fallback-voice notices near article audio controls.

Emergency switch:

1. Set `TTS_PRIMARY_PROVIDER=edge`.
2. Keep `TTS_EDGE_FALLBACK=true`.
3. Redeploy or restart the environment if the platform requires it for env changes.
4. Switch `TTS_PRIMARY_PROVIDER=openai` again when OpenAI spend and rate pressure settle.

## Podcasts

Curio Garden can publish multiple RSS feeds:

- Featured Articles: `/api/podcast/featured.xml`
- Trending Brief: `/api/podcast/trending.xml`
- Personal Playlist: `/api/podcast/personal.xml?token=...`

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

Personal Playlist:

- The feed is account-scoped and exposed only through an opaque tokenized URL shown in the signed-in dashboard.
- Each queue item becomes one full-article episode once background generation finishes.
- Only `ready` items appear in the RSS feed, and enclosure URLs are served from `/api/podcast/media/personal/[episodeId]?token=...`.
- The feed uses generic Curio Garden show metadata and cached artwork from `/api/podcast/personal/artwork`.
- This feed is meant for `Follow a Show by URL` in podcast apps, not for listing in the public podcast directory.

To enable scheduled generation in production:

1. Set `CRON_SECRET` in Vercel project environment variables.
2. Deploy the app.
3. Vercel will call `/api/featured/cron`, `/api/podcast/featured/cron`, `/api/picture-of-day/audio/cron`, and `/api/podcast/trending/cron` using the schedules in `vercel.json`.

The default schedules are:

- `5 0 * * *` and `35 0 * * *` for the Today on Wikipedia snapshot (`00:05 UTC` primary run, `00:35 UTC` retry shortly after Wikipedia's daily UTC rollover)
- `10 0 * * *` and `40 0 * * *` for the featured podcast (`00:10 UTC` primary run, `00:40 UTC` retry shortly after Wikipedia's daily UTC rollover)
- `20 0 * * *` and `50 0 * * *` for Picture of the Day audio (`00:20 UTC` primary run, `00:50 UTC` retry)
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
6. Test the personal playlist feed:
   sign in locally, add an article to Playlist, then copy the tokenized feed URL from `/dashboard`

For Apple Podcasts and other validators, use a preview or production HTTPS deployment instead of `localhost`; podcast clients generally expect the feed, artwork, and media URLs to be publicly reachable.

## Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js + Convex backend |
| `npm run dev:python` | Start Next.js + Convex + Python TTS server |
| `npm run local` | Local mode — no Convex, audio through the canonical TTS route with Edge fallback available locally |
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
  dashboard/page.tsx      Signed-in account hub for synced library and playlist queue
  search/page.tsx         Search results page
  article/[slug]/page.tsx Article view with audio playback
  library/page.tsx        Saved reading list (guest-local or account-synced)
  podcast/page.tsx        Redirects legacy /podcast to /podcasts
  podcasts/page.tsx       Public podcast index page for both feeds
  podcasts/[slug]/page.tsx Dedicated archive page for each podcast feed
  globals.css             Design system tokens, utilities, and component styles
  api/tts/route.ts        Canonical OpenAI-first TTS API route
  api/tts/edge/route.ts   Edge TTS fallback route (local dev shells out to Python)
  api/featured/route.ts   Featured article API route
  api/picture-of-day/audio/cron/route.ts  Scheduled Picture of the Day audio prewarm
  api/trending/brief/route.ts  Daily AI-generated trending briefing API route
  api/podcast/featured.xml/route.ts  RSS feed for featured podcast episodes
  api/podcast/featured/sync/route.ts Manual featured-episode generation trigger
  api/podcast/featured/cron/route.ts Scheduled featured-episode generation trigger
  api/podcast/personal.xml/route.ts  Tokenized personal playlist RSS feed
  api/podcast/personal/artwork/route.ts  Personal playlist show artwork
  api/podcast/trending.xml/route.ts  RSS feed for trending-brief podcast episodes
  api/podcast/trending/sync/route.ts Manual trending-brief generation trigger
  api/podcast/trending/cron/route.ts Scheduled trending-brief generation trigger
  api/podcast/media/[episodeId]/route.ts Stable podcast media URL
  api/podcast/media/personal/[episodeId]/route.ts Stable personal playlist media URL
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
  personal-show-podcast-artwork.ts  Artwork generator for the personal playlist show
  tts-normalize.ts        Text normalization for TTS (abbreviation expansion)
  nsfw-filter.ts          Shared NSFW category/keyword filter and batch title check
  formatTime.ts           Duration formatting helpers

components/
  AccessibleLayout.tsx    Skip link, navbar, footer, landmark structure
  AuthNavControls.tsx     Clerk sign-in, sign-up, and user menu controls
  DashboardHub.tsx        Signed-in dashboard shell with library and playlist modules
  SearchForm.tsx          Accessible search form (GET /search?q=...)
  SearchResultsList.tsx   Wikipedia search results with loading/error states
  ArticleView.tsx         Article loader with audio playback, thumbnails, and resume
  ArticleGallery.tsx      Image gallery with captions extracted from article HTML
  ArticleHeader.tsx       Article metadata, links, license info
  AudioPlayer.tsx         File-based audio player with seek/scrub/download
  TableOfContents.tsx     Section list with per-section playback and Play All
  BookmarkButton.tsx      Save/unsave article to reading list
  PlaylistActionButton.tsx  Add-article action for the personal playlist queue
  BackButton.tsx          Navigation back button
  RecentlyListened.tsx    Recently listened articles grid (home page)
  FeaturedArticle.tsx     Today's Featured Article card with thumbnail (home page)
  TodayOnWikipedia.tsx    Featured, Did You Know, news, picture, On This Day, and trending digest
  CuriousAbout.tsx        Legacy trending articles grid with thumbnails
  RandomArticleButton.tsx "Surprise me" button with NSFW category filter
  RelatedArticles.tsx     "Listen next" suggestions after playback
  LocalModeBanner.tsx     Dismissable banner shown in local mode
  ThemeProvider.tsx       Dark/light theme with useSyncExternalStore
  ThemeToggle.tsx         Theme toggle button (sun/moon icons)
  CopyFeedButton.tsx      Clipboard copy button for podcast feed URLs
  PodcastFeedActions.tsx  Feed copy helpers and Apple Podcasts instructions
  ServiceWorkerRegistration.tsx  Registers the PWA service worker

hooks/
  usePlaybackRate.ts      Persisted playback speed (0.5x–3x)
  useHistory.ts           Reading history with resume progress tracking
  useBookmarks.ts         Hybrid reading list / saved articles (guest + account)
  usePersonalPlaylist.tsx Signed-in personal playlist state and actions
  useAudioElement.ts      Shared HTML audio element management

convex/
  auth.config.ts         Clerk JWT provider configuration for Convex
  auth.ts                Authenticated viewer query used for the integration smoke test
  schema.ts              Database schema (articles, bookmarks, playlist feeds, podcast episodes/jobs)
  search.ts              Wikipedia search action
  articles.ts            Article query, upsert mutation, fetch-and-cache action
  audio.ts               Section audio caching (query, upload, save)
  trending.ts            Daily trending-brief queries and mutations
  podcast.ts             Featured podcast queries, mutations, and upload helpers
  personalPlaylist.ts    Viewer-scoped playlist queue, generation, and RSS feed helpers
  lib/
    wikipedia.ts         Wikipedia REST/Action API client (also used by local mode)

scripts/
  build.sh               Vercel build script (production/preview/local)
  dev-tts.py             Local Python TTS dev server

public/
  manifest.json          PWA manifest
  sw.js                  Service worker (cache-first for assets, network-first for APIs)
  icon.svg               App icon

proxy.ts                Clerk middleware entrypoint for App Router auth
```

## Data Model

Primary Convex tables:

- `articles` stores cached Wikipedia article data used across search, article views, and podcast generation.
- `bookmarks` stores saved Library articles keyed by viewer identity, with guest imports merged into signed-in accounts on the same device.
- `personalPodcastFeeds` stores one opaque feed token per signed-in viewer for the tokenized Personal Playlist RSS feed.
- `personalPlaylistEpisodes` stores the ordered personal queue plus generation state, progress, and stored MP3 metadata for each playlist episode.
- `sectionAudio` stores per-section audio blobs keyed by article, section key, provider, model, voice, prompt version, and TTS normalization version.
- `podcastShowAssets` stores cached show artwork for featured, trending, and personal feeds.
- `featuredPodcastEpisodes` stores one generated podcast episode per featured article date, including storage metadata and publication state.
- `featuredPodcastJobs` tracks scheduled/manual generation attempts and failures for the featured podcast pipeline.
- `trendingBriefs` stores one AI-generated, TTS-rendered daily briefing per Wikipedia trending date, including provider-versioned audio variants and the image URLs used to generate trending collage artwork.
- `pictureOfDayAudio` and `pictureOfDayAudioJobs` store the cached daily Picture of the Day spoken description and its generation lease state.

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
