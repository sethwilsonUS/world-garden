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
`ARTICLE_CONTEXT_WRITE_SECRET`, `PRODUCT_FEEDBACK_WRITE_SECRET`,
`TTS_QUOTA_BYPASS_SECRET`, `CRON_SECRET`, and `ANALYTICS_REPORT_SECRET`—must
match across the two environments where their corresponding features are
enabled. Anonymous product feedback requires
`PRODUCT_FEEDBACK_WRITE_SECRET` whenever local mode is off. Generate a random
value that is distinct from every other secret, then set the exact same value
in the Next.js/Vercel environment and the matching Convex deployment. Deployed
audio requires
`TTS_QUOTA_BYPASS_SECRET`: only short-lived, domain-separated attestations—not
the root secret—are sent through public quota/cache mutations and trusted TTS
requests. Convex audio workers use `AUDIO_GENERATION_BASE_URL` as their trusted
HTTPS app origin (production by default). Vercel Preview builds set the exact
generated origin and sync the required shared secrets into only the matching
isolated Convex Preview.

The first-party AI/audio cost ledger is server-only and additive. Set
`AI_COST_LEDGER_MODE=observe` in both Next.js/Vercel and the matching Convex
deployment to record best-effort provider, cache, generation, and signed-in
unique-heard aggregates. Missing or invalid values act as `off`; there is no
enforcement mode. Provider/cache writes use short-lived attestations derived
from `TTS_QUOTA_BYPASS_SECRET`, while owner reports and provider-statement
upserts use payload-bound attestations derived from `ANALYTICS_REPORT_SECRET`.
Raw operational rows expire after 90 days through the bounded Convex cleanup;
privacy-reduced daily rollups and aggregate statements remain available for
longer-term reconciliation. See
[`docs/ai-cost-ledger-runbook.md`](../docs/ai-cost-ledger-runbook.md) for metric
definitions, privacy exclusions, pricing sources, and rollout steps.

Personal Playlist OpenAI scheduling is bounded per account with
`PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT` (default `10`),
`PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS` (default `86400000`), and
`PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT` (default `5`); configure these in each
Convex deployment. New episodes consume daily allowance, each episode receives
one free retry, and later retries normally consume allowance again; exact reuse
does not.

## Validation and deployment

Convex logic is covered by the repository's colocated Vitest suites. Before a
pull request, run:

```bash
npm run check
LOCAL_MODE=true NEXT_PUBLIC_LOCAL_MODE=true npm run build
```

Production deployment is handled by `scripts/build.sh` on Vercel. A production
build runs `convex deploy`; a preview build creates an isolated Convex Preview
for the branch. Vercel Preview must provide a key beginning with the exact
`preview:seth-wilson:world-garden|` prefix rather than a development,
production, or cross-project key.

The Preview flow validates that local key shape before any Convex CLI call. It
then performs `convex deploy --dry-run --preview-create` so Convex authenticates
the key's project without claiming or updating a deployment. The real deploy
may then claim or reuse the named Preview before running the build helper. The
helper builds Next.js before writing any Convex environment values, copies the
required secrets, and writes the exact Vercel `AUDIO_GENERATION_BASE_URL` last;
Convex pushes functions only after the helper succeeds. A failed Next.js build
can therefore leave a named Preview claimed or reused, but it does not apply
those environment writes or push functions.

Before the first claim, configure `CLERK_JWT_ISSUER_DOMAIN` as a Convex Preview
environment-variable default using the issuer for the same Clerk Preview
instance configured in Vercel. Defaults are copied only when a Preview is
created; update existing deployments directly or recreate them after a default
changes. For protected Vercel Previews, enable Protection Bypass for Automation;
Vercel injects `VERCEL_AUTOMATION_BYPASS_SECRET` automatically, and the helper
copies that system value instead of relying on a manually created Vercel
variable. Run `npx convex deploy` manually only when you intend to update the
configured production deployment.

See the root [README](../README.md) for the complete architecture, environment
variable reference, data model, and scheduled-job inventory.
