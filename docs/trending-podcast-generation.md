# Trending Podcast Generation

The daily Trending podcast is pinned to `gpt-6-luna` with high reasoning for research, writing, and script repair. Its prompt identity is `trending-brief-deep-research-v1`. Optional article-context accessibility descriptions use the same model and reasoning level. The retired `TRENDING_BRIEF_MODEL` and `CONTEXT_DESCRIPTION_MODEL` environment overrides are ignored.

## Research and writing

The generator takes up to ten articles from the daily Wikimedia trending snapshot. Each topic receives one Responses API research pass with high web-search context, with at most four topics running concurrently. Research identifies the likely trigger, timeline, background, confidence, and uncertainty for that topic.

The writer receives every research note and up to 15 representative sources. Sources are interleaved across topics and deduplicated without tracking-only URL differences. The script covers all included topics, gives more space to well-supported leaders, and states uncertainty when the research cannot establish a cause.

The `spokenSummary` must contain 300–420 words. A script outside that band gets one writing-only repair using the same research, without adding claims. Completed research is saved under the active job lease before repair so a later attempt can retry writing without repeating successful searches. A second miss fails before narration or publication.

## Runtime limits

- Each research, writing, or repair request allows 12,000 output tokens, including hidden reasoning tokens.
- Each OpenAI request has a two-minute timeout and no SDK retries. The first failed topic cancels its in-flight peers.
- Text generation has an 11-minute overall deadline.
- The cron and manual sync routes allow 800 seconds; the Convex job lease lasts 15 minutes, leaving time for artwork, speech, uploads, and finalization after text generation.

## Narration and publication

Narration is pinned to OpenAI `gpt-4o-mini-tts` with the `marin` voice and the current default narration prompt. The spoken audio includes an AI disclosure. Trusted Trending speech requests use signed background attestation, bypass the interactive quota, and forbid Edge fallback. General TTS model and voice overrides do not change this publication configuration.

Validated prose is persisted before artwork and speech. A downstream failure preserves reusable prose and any prior ready episode, allowing a later cron attempt to retry narration without repeating successful research. Model and prompt versions participate in reuse eligibility; existing ready episodes remain readable.

The protected `GET /api/podcast/trending/cron` runs at 04:45 UTC and retries at 05:15 UTC. `POST /api/podcast/trending/sync` provides a manual trigger. Both require `CRON_SECRET`; trusted speech also requires matching `TTS_QUOTA_BYPASS_SECRET` values in the app and Convex. Episodes publish to `/api/podcast/trending.xml` after audio and artwork complete.

Monitor failures by stage, writing repairs, web-search usage and estimated text cost, strict TTS failures, and successful reuse on retries. Listener feedback helps assess depth and pacing.
