# AI cost ledger runbook

The AI cost ledger is first-party operational accounting. It observes the
provider, cache, and signed-in listening boundaries that already exist; it does
not change quotas, provider selection, fallback, playback, or the public audio
promise. The only runtime modes are `off` and `observe`.

## Metric dictionary

Money is stored as integer micros of its ISO currency. Durations, token counts,
character counts, word counts, request counts, and byte counts are integers.
An unavailable measurement is `null` or `unknown`, never a guessed zero.

- `provider_attempts` counts one idempotent accounting record opened at a
  provider boundary. It includes `failed_before_dispatch`; the dispatched,
  potentially billable subset is reported separately. Lifecycle values are
  `succeeded`, `failed_before_dispatch`, `failed_after_dispatch`, and
  `unknown_after_dispatch`.
- `potentially_billable_attempts` includes successful, failed-after-dispatch,
  and unknown-after-dispatch attempts. It excludes failures before dispatch.
- `unique_generated_assets` counts cacheable units for which one new provider
  response won persistence. Competing provider calls remain provider attempts,
  but a concurrent cache race does not create a second unique asset.
- `reused_asset_serves` counts authoritative server-side reuse of persisted
  audio. Direct reuse of an already-held browser URL is not included.
- `cache_requests`, `cache_hits`, and `cache_misses` describe authoritative
  server/cache decisions. `cache_request_hit_rate` is:

  ```text
  cache_hits / (cache_hits + cache_misses)
  ```

  It is `null` when the denominator is zero.

- `avoided_generation` counts decisions where an existing asset prevented a
  provider generation call.
- `reuse_factor` is:

  ```text
  reused_asset_serves / unique_generated_assets
  ```

  It is `null` when no unique asset was generated in the range.

- `signed_in_unique_heard_seconds` is server-merged, signed-in, naturally heard
  media time. Seeks, skip jumps, overlaps, headings, and transitions do not add
  time. Playback speed changes wall-clock time, not heard media duration.
- `signed_in_unique_heard_hours` is
  `signed_in_unique_heard_seconds / 3600`.
- `observed_meaningful_use` means an observable article listening cohort
  accumulated at least 60 unique heard seconds, or reached 80% of a
  progress-counting item whose duration is at least 15 seconds.
- `awaiting_observation` means the generation has not yet completed its 30-day
  observation window.
- `no_observed_meaningful_use` means a mature, observable generation cohort did
  not reach the meaningful-use rule. It does not mean "never played" or
  "wasted."
- `external_consumption_unknown` covers generated audio intended for direct
  downloads, feeds, podcasts, or other clients whose listening is deliberately
  not proxied or tracked.
- `estimated_direct_ai_cost_micros` is calculated from the versioned local
  price table and measured provider usage. Its quality is
  `derived_from_provider_usage`, `locally_measured_estimate`, or `unknown`.
- `reconciled_direct_ai_cost_micros` is an attributable provider-reported
  statement amount. It is the reconciliation authority for its covered period.
- `allocated_infrastructure_cost_micros` is reserved for a future explicit
  infrastructure source and allocation method. V1 does not import shared
  infrastructure statements, so this field remains `null`.
- `fully_loaded_cost_micros` is reconciled direct AI cost plus documented
  allocated infrastructure cost. It is `null` when that allocation is absent.
- `reconciled_direct_ai_cost_per_observed_useful_hour` is:

  ```text
  reconciled_direct_ai_cost_micros
  / (signed_in_unique_heard_seconds / 3600)
  ```

  It is `null` when there is no fully covered provider statement, when the
  listening denominator is zero, when the immutable coverage marker does not
  precede the requested UTC range, or when the rollups expose a known provider-
  attempt accounting gap. Its separate coverage-quality field says only what
  that evidence supports; a marker is not proof of uninterrupted delivery. The
  fully loaded variant is also `null` unless infrastructure allocation is
  configured.

## Authoritative instrumentation seams

- Provider accounting starts immediately before each real dispatch. The OpenAI
  SDK uses an instrumented `fetch`, so each SDK retry is a distinct attempt.
  Article-context and trending-brief call sites supply their bounded operation
  and source context and retain response usage metadata. The central TTS route
  correlates OpenAI and subsequent Edge fallback attempts without collapsing
  them. Ordinary public article requests receive the route-owned
  `interactive_article` source. Background TTS producers send a bounded source
  with a five-minute server HMAC, matching the bounded generation/retry window;
  an expired, unsigned, or invalid client-supplied source is recorded as
  `unknown` and cannot choose a background attribution bucket.
- TTS inputs are measured before dispatch. Successful speech responses preserve
  byte length. OpenAI's binary speech response does not report speech token
  usage, so speech token fields remain `null`; the ledger does not reverse-
  engineer or invent them.
- Cache lookup and persistence are measured inside the Convex audio boundary.
  A verified persisted asset is a hit/reuse. A miss is generation only after
  new response bytes exist. The atomic persistence result distinguishes the
  unique winner, an idempotent retry, a concurrent race, and a failed write.
- Article-audio pipeline generated/reused section counters feed the same bounded
  daily rollup. Provider attempts and cache-persistence outcomes remain the
  accounting authority; pipeline counters are operational diagnostics.
- Listening reuses the existing anti-seek browser sampler and batched Convex
  progress mutation. Convex merges unique integer media ranges and contributes
  only newly heard seconds. Existing badge qualification remains unchanged.
  When one listening session first becomes meaningful across multiple tracks,
  the contribution includes every progress-counting track heard in that
  session. The current ledger event has one attribution cutoff, so this
  cross-track event deliberately uses the session start for every included
  track. That conservative cutoff can under-attribute a generation created
  later in the session, but it cannot credit a newer, unheard regeneration of
  an earlier track.
- Generation-to-use analysis is an aggregate article/section cohort join inside
  Convex. The opaque asset-to-article/section seam is cleared when meaningful
  use is observed or its 30-day observation window closes; it is never returned
  by the report. This avoids adding a user or device ID and avoids exposing a
  generation key to the browser.

Ledger calls are best effort. In `observe`, a ledger error may emit one concise
server warning, but it cannot reject work, delay fallback, or alter a product
response. In `off`, provider, cache, generation, and listening ledger writes are
skipped.

## Privacy and retention

The ledger accepts bounded enums, integer measurements, coarse model/profile
values, server-generated idempotency keys, and opaque correlation/linkage only.
It does not accept or store article or narration text, summaries, titles,
section headings, search terms, URLs, feed tokens, email addresses, account IDs,
IP addresses, raw error messages, request bodies, or payment data. Owner reports
return aggregates only.

Raw provider-attempt, cache, generation-cohort, listening-contribution, and
pipeline event rows become eligible for deletion after 90 days. A bounded
scheduled Convex cleanup deletes at most 500 expired rows per mutation and
schedules another batch when a backlog remains, so a cleanup backlog can retain
a row longer. If cohort finalization is backlogged, cleanup applies the
mature cohort delta and removes its short-lived article/section seam atomically
before deleting the raw row. Privacy-reduced UTC daily rollups and aggregate
cost statements may be kept for longer-term accounting.
After raw deletion, a durable duplicate-prevention receipt retains only the
opaque event key, bounded event kind, and provider lifecycle version. It has no
article, section, account, content, URL, or measurement fields and prevents an
old replay from adding the same event to a long-lived aggregate twice. The
ledger does not reconstruct historical raw events.

Meaningful-use evaluation temporarily keeps an exact signed-in listening-session
accumulator on the existing account-owned progress row. It contains the session
start and normalized heard ranges, with a separate expiry of two hours after
the last write attributed to that session. Unrelated progress writes do not
extend the expiry. Writes opportunistically clear expired state, and an hourly
cleanup scans at most 100 progress rows per pass and immediately continues
through the remaining cursor. That cleanup runs independently of
`AI_COST_LEDGER_MODE` and treats legacy accumulators without an expiry as
expired. Account exports include only a live accumulator and its expiry.

Listening coverage is deliberately partial: it is signed-in, in-app article
listening observed by the existing progress system. It excludes guests and does
not claim population-wide listening. Podcast, download, and external-client use
is unobservable and is classified as `external_consumption_unknown`.

## Pricing versions

Pricing was verified on 2026-07-28 against official OpenAI documentation:

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-4o mini TTS model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- [Create speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)

The local price table records an immutable version and `effectiveFrom` date.
Changing a rate means adding a version, never rewriting an old version. The
2026-07-28 GPT-5.6 Luna standard short-context version uses $1.00 per million
uncached input tokens, $0.10 per million cached input tokens, $1.25 per million
cache-write input tokens, and $6.00 per million output tokens. Web search is
$10.00 per thousand calls in addition to applicable model token costs. Requests
using an unsupported service tier or beyond the supported short-context tier
return an unknown local estimate rather than silently applying the wrong rate.
Web-search tool calls are captured separately from language-model token usage.

The published GPT-4o mini TTS rates are $0.60 per million text input tokens and
$12.00 per million audio output tokens. The speech endpoint's binary response
does not provide those counts, so the ledger leaves its local TTS cost unknown;
it does not convert characters or estimated duration into invented tokens.

Microsoft Edge's online TTS adapter is not connected to an Azure billing
account in this codebase. It therefore has no provider-reported Azure cost and
must not be described as zero-cost Azure usage; its estimate remains unknown.

## Provider statements and reconciliation

An owner may upsert aggregate statements through the authenticated statement
route. Each statement has a provider, bounded service scope, half-open UTC
period, USD currency in V1, integer amount micros, source (`provider_costs_api`,
`invoice_total`, or `manual_entry`), and an idempotency identifier. V1
deliberately rejects free-text statement notes, so secrets, invoice contents,
and personal information cannot be persisted there; keep private accounting
annotations outside the ledger.

[OpenAI's organization Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
can be used by a maintainer-side importer with an Admin API key. The key must
remain outside the browser and repository. The API provides daily costs and can
group by project and line item; usage endpoints remain useful context but are
not a substitute for a cost statement. A manual aggregate upsert is the
supported fallback. Never scrape the billing UI or commit an invoice.

Statements remain intact as the source total. The headline reconciled amount is
available only when non-overlapping statements exactly match the requested UTC
range and unambiguously cover every active provider/service scope. A partial,
overlapping, duplicate, or scope-incomplete statement set leaves the headline
and reconciled unit cost `null`; the report explains the gap rather than
prorating an arbitrary slice of a provider total. An `all_direct_ai` statement
is the simplest complete import for a provider.

Scoped statement billing components are disjoint: `responses` means model and
token charges but excludes web-search tool fees, `web_search` means only those
tool-call fees, and `speech` means speech-service charges. A response statement
cannot use combined estimated-cost weights when observed rows also contain
search fees; use response token weights, leave it unallocated, or import one
`all_direct_ai` statement. This prevents false precision in daily allocation.

When a statement uses a measured allocation method, its cost is distributed
across eligible UTC days and operations in proportion to the selected billable
units. Integer micros use largest-remainder rounding with a stable tie-break, so
allocated rows sum exactly to the original statement. `unallocated` preserves
the provider total while leaving day/operation reconciled cells unavailable.
Ranges whose marker follows `from`, and ranges with a detected provider-attempt
accounting gap, keep the provider total but withhold local allocation.
V1 does not implement infrastructure-statement import or allocation. The
infrastructure and fully loaded fields therefore remain `null`; a future
implementation must keep those statements in their own cost class with an
explicit source and allocation method.

Example manual upsert (synthetic values only; `periodEndDay` is exclusive):

```bash
curl --fail-with-body --request POST \
  --header "Authorization: Bearer $ANALYTICS_REPORT_SECRET" \
  --header "Content-Type: application/json" \
  --data '{
    "statementKey":"openai-costs:2026-07",
    "provider":"openai",
    "serviceScope":"all_direct_ai",
    "periodStartDay":"2026-07-01",
    "periodEndDay":"2026-08-01",
    "amountMicros":130000,
    "currency":"USD",
    "source":"manual_entry",
    "allocationMethod":"unallocated"
  }' \
  "$NEXT_PUBLIC_SITE_URL/api/analytics/costs/statements"
```

## Owner report and CLI

Set the same `ANALYTICS_REPORT_SECRET` in the Next.js/Vercel and matching Convex
environments. The HTTP route compares the bearer value in constant time, then
sends Convex a short-lived, payload-bound attestation rather than the root
secret. Responses use `Cache-Control: no-store` and contain no raw ledger rows
or internal linkage.

Query a half-open UTC date range of at most 90 days:

```bash
npm run report:costs -- --from 2026-07-01 --to 2026-08-01
npm run report:costs -- --from 2026-07-01 --to 2026-08-01 --limit 100
npm run report:costs -- --from 2026-07-01 --to 2026-08-01 --csv
npm run report:costs -- --from 2026-07-01 --to 2026-08-01 --csv --output ./costs.csv
npm run report:costs -- --from 2026-07-01 --to 2026-08-01 --json
npm run report:costs -- --help
```

`npm run analytics:costs` remains available as a compatibility alias.

The command reads `ANALYTICS_REPORT_SECRET` and the site origin from the process
environment or `.env.local` without overwriting already-set environment values.
Human output uses headings and labeled lists rather than visually encoded pipe
tables and defaults to 50 entries per daily/provider/operation breakdown;
headline totals are never truncated and always refer to the complete requested
range; an unavailable total remains `null`. `--limit` changes each repeated
breakdown without changing those totals. JSON is suitable for a private
downstream accounting workflow. The default terminal view also labels
attempt lifecycle and fallback counts, estimate and allocation quality,
pipeline generation/reuse, cohort rates, temporal coverage, detected
instrumentation gaps, and measurement-quality counts.

`--csv` exports stable total, daily, provider, and operation cost rows. Without
`--output`, it creates a timestamped file under `.reports/ai-costs/`. Exports
are created with mode `0600`, never overwrite an existing path, neutralize
spreadsheet-formula prefixes, and remove a partial file after a failed report.
Owner-report requests time out after 60 seconds. `--output` requires `--csv`;
`--csv` and `--json` are mutually exclusive.

The first accepted operational write in an `observe` epoch creates that epoch's
immutable coverage marker using the Convex transaction time. Reports use the
current marker, not the earliest surviving rollup or reset time, so a range
beginning before the marker (including midnight earlier on the marker's UTC
day) remains partial. A later range reports
`marker_precedes_requested_range` once its `from` boundary is at or after the
marker. This remains evidence-level wording: the marker does not prove that
every best-effort delivery succeeded.

## Configuration, rollout, and rollback

Configure `AI_COST_LEDGER_MODE` independently in Next.js/Vercel and the matching
Convex deployment. Accepted values are `off` and `observe`; missing, empty, or
invalid values act as `off`. Do not use a `NEXT_PUBLIC_` name.

For a 30-day observe-only rollout:

1. Set `AI_COST_LEDGER_MODE=observe` in both server environments, confirm the
   existing shared `TTS_QUOTA_BYPASS_SECRET`, and configure a distinct
   `ANALYTICS_REPORT_SECRET` on both sides.
2. Use synthetic calls to confirm successful dispatch, failure/fallback,
   idempotent replay, cache hit/miss, and fail-open behavior.
3. Confirm the immutable coverage marker exists, verify there has been no
   `off` interval since that marker, and confirm raw cleanup is scheduled and
   bounded. Then review privacy exclusions and report access with the
   maintainer.
4. Import a provider statement for a closed UTC period. Verify statement total,
   allocated total, estimate variance, currency, and coverage dates exactly.
5. Review the report weekly for unknown measurements, ambiguous attempts,
   cache-write failures/races, missing statements, and cohort maturity.
6. After 30 days, decide whether quota, funding, pricing, donation, or product-
   promise work is warranted. Treat that as a separate product decision; this
   ledger has no enforcement mode.

Rollback is setting `AI_COST_LEDGER_MODE=off` in both environments. Existing
ledger rows remain available for their retention period, but new operational
writes stop and product behavior continues unchanged. Any `off` interval ends
the current coverage epoch. Toggling the environment variable back to
`observe` alone is unsupported because it would leave the old marker looking
continuous across the gap.

To re-enable observation after any pause:

1. Confirm `AI_COST_LEDGER_MODE=off` in **both** Next.js/Vercel and the matching
   Convex deployment. Do not reset while either side can still accept observe-
   mode writes.
2. Generate a fresh opaque idempotency key (a UUID is suitable) and reset the
   current epoch through the owner-only route. Replace the example value; never
   reuse a key from an earlier transition.

   ```bash
   curl --fail-with-body --max-time 60 \
     --request POST \
     --header "Authorization: Bearer $ANALYTICS_REPORT_SECRET" \
     --header "Content-Type: application/json" \
     --data '{"epochKey":"replace-with-a-fresh-uuid"}' \
     "$NEXT_PUBLIC_SITE_URL/api/analytics/costs/coverage"
   ```

3. Confirm the response reports `reset: true`. A transport retry may use the
   **same** key and returns `disposition: duplicate` without clearing a marker
   that may already have been established. Any later transition needs a new
   key. Convex retains only that opaque key, its epoch version, and reset time
   as a durable idempotency receipt; never put user data or free text in it.
4. Re-enable `observe` in both environments. Until the first accepted
   operational ledger write, reports return unknown coverage. That write
   atomically establishes the new marker; ranges beginning before it remain
   partial.

## Known blind spots

- Production Edge speech is served by the Python adapter. The central route can
  observe its internal adapter request and returned bytes, but cannot prove the
  exact dispatch moment inside the third-party `edge-tts` library. This is
  labeled as adapter-boundary coverage, not exact provider billing telemetry.
- Direct browser Edge-cache queries cannot write from a Convex query, so those
  hits are excluded rather than inferred. Server-side cache decisions remain
  authoritative for the reported cache rate.
- Article/section cohort matching is aggregate and revision/profile aware only
  to the degree supported by the existing stored cache/listening relationships.
  It does not claim exact per-listen attribution to an individual byte asset.
- Older generations and listening progress are not backfilled. Coverage begins
  at the first accepted observe-mode ledger write, and partially covered periods
  are reported as such. `observed_activity_start_day` is merely the first rollup
  in the requested range and is not used as a substitute for that marker.
- `instrumentation_completeness: no_known_gaps` means the report found no
  mismatch between persisted provider-attempt counts and their known/unknown
  estimate counts; it is evidence-based, not a promise that every best-effort
  event write succeeded. Generation, cache, and pipeline events may legitimately
  land under a different bounded source or UTC day, so the report does not infer
  missing attempts by comparing those unjoinable aggregate streams. A provider
  attempt write that is entirely lost through the fail-open path can therefore
  remain undetectable without raw cross-system correlation, which this
  privacy-minimized ledger deliberately does not retain.
- `range_coverage: marker_precedes_requested_range` means only that the current
  epoch's first accepted-write marker is early enough. The explicit reset makes
  a known `off` interval conservative by hiding the old marker until a new write
  is accepted, but the system cannot infer a pause if an operator skips the
  required reset. The report intentionally does not call this status complete
  coverage.
- Direct feeds and downloads intentionally have unknown consumption. No media
  proxy, guest fingerprint, or persistent anonymous identifier is introduced.

The implementation is not production-ready merely because the code is merged.
It becomes decision-grade only after provider reconciliation, cleanup/retention
verification, privacy review, fail-open verification, and a completed observe-
only coverage window.

## Repository audit note

The provider seams used are `app/api/tts/route.ts`, the shared OpenAI client in
`lib/openai-client.ts`, and the existing article-context and trending-brief
generators. Cache measurements use `convex/audio.ts`,
`app/api/article/audio/section/route.ts`, and
`convex/lib/articleAudioPipeline.ts`. Listening contributions reuse
`lib/listen-progress.ts`, `hooks/useBadgeListenTracking.ts`, and
`convex/badges.ts`. Owner access follows the existing analytics report route
convention but replaces raw-secret forwarding with payload-bound attestations.

Several prompt assumptions were stale or necessarily narrower after the audit:

- OpenAI-to-Edge fallback is sequential, not a provider race.
- Production rewrites Edge TTS to `_python/tts.py`; the TypeScript route records
  the internal adapter call, while exact third-party dispatch remains inside the
  `edge-tts` library.
- OpenAI SDK text calls can retry internally, so accounting belongs in the
  client's `fetch` boundary rather than only around the high-level SDK method.
- The public Convex cache query used directly by the browser cannot authoritatively
  write a hit counter. Those hits are excluded.
- Existing rows do not contain an exact generation-to-listen identifier, and
  adding one to public media responses would be more invasive. V1 therefore
  uses a conservative aggregate article/section cohort inside Convex.
