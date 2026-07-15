# Curio Garden Convex Backend

This directory contains Curio Garden's persisted data model, account-scoped
queries and mutations, scheduled workers, Wikipedia actions, and generated
audio/podcast storage workflows. The Next.js app can run without Convex in
local mode, but synced accounts, durable caches, personal playlists, analytics
rollups, and publication jobs use this backend.

## Important entry points

- `schema.ts` is the source of truth for tables and indexes.
- `auth.config.ts` connects Clerk JWT sessions to Convex.
- `articles.ts`, `audio.ts`, and `bookmarks.ts` expose the core article,
  narration-cache, and signed-in library operations.
- `personalPlaylist.ts` preserves the public playlist API while delegating
  persistence and worker orchestration to focused modules.
- `articleContexts.ts` preserves the article-context API while validation,
  cache, report, and moderation logic lives in focused sibling modules.
- `featured.ts`, `podcast.ts`, `trending.ts`, and their worker modules manage
  daily discovery and podcast generation.
- `lib/` contains reusable server-only helpers, including the Wikipedia client.

Files under `_generated/` are produced by the Convex CLI. Do not hand-edit
them; run `npx convex dev` or `npx convex codegen` after changing registrations
or the schema.

## Local development

From the repository root:

```bash
npm ci
npm run dev
```

`npm run dev` starts Next.js and `convex dev` together. On first use, the Convex
process creates or selects a development deployment, writes the local Convex
URL, pushes functions, and keeps generated types current. Run
`npx convex dev` separately only when you need the backend without Next.js. Add
`CLERK_JWT_ISSUER_DOMAIN` in the Convex dashboard when testing signed-in flows.
Secrets used by both Next.js and Convex—such as
`ARTICLE_CONTEXT_WRITE_SECRET`, `TTS_QUOTA_BYPASS_SECRET`, `CRON_SECRET`, and
`ANALYTICS_REPORT_SECRET`—must match across the two environments where their
corresponding features are enabled.

## Validation and deployment

Convex logic is covered by the repository's colocated Vitest suites. Before a
pull request, run:

```bash
npm run check
LOCAL_MODE=true NEXT_PUBLIC_LOCAL_MODE=true npm run build
```

Production deployment is handled by `scripts/build.sh` on Vercel. A production
build runs `convex deploy`; a preview build creates an isolated Convex preview
deployment for the branch. Run `npx convex deploy` manually only when you
intend to update the configured production deployment.

See the root [README](../README.md) for the complete architecture, environment
variable reference, data model, and scheduled-job inventory.
