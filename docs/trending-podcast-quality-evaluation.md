# Trending Podcast Quality Evaluation

## Luna deep research is the production choice

The production choice is **GPT-5.6 Luna with per-topic deep research and the depth-writing prompt**.

The strongest raw editorial result came from Sol with deep research at 91.2. Luna with deep research scored 89.5, finished within the predeclared five-point quality band, and was the lowest-cost and lowest-latency passing finalist. It therefore won the planned near-tie rule without giving up the contextual depth that motivated this work.

The promoted production identity is:

- Text model: `gpt-5.6-luna`
- Generation profile: `deep-research`
- Prompt provenance: `trending-brief-deep-research-v1`
- Spoken target: 300–420 words before the audible AI disclosure
- Narration: OpenAI `gpt-4o-mini-tts`, voice `marin`
- Narration fallback: forbidden for the trusted Trending job; a failed job is retried by the second daily cron rather than published with Edge

No evaluation run invoked podcast sync, Convex mutations, storage uploads, feed publication, deployment, or backfill.

## Why the previous result felt shallow

The control configuration asked one broad research response to cover ten unrelated articles, described the research note as short, requested low writing verbosity, and imposed no spoken-length or topic-coverage floor. Those instructions reliably produced only 102–122 spoken words in this evaluation.

The live feed showed the same pattern before this work: the then-current episode contained 101 generated spoken words and lasted 49 seconds. Recent episodes had a median duration near 55 seconds. That evidence supports the reported regression, although it does not by itself prove that one code change caused every shorter episode.

The experiment shows that upgrading the writer alone is not the main answer. The decisive improvement came from giving each topic its own bounded, high-context research pass and explicitly asking the writer for supported triggers, relevant background, a timeline, a “why now” explanation, and labeled uncertainty.

## The experiment compared 24 frozen-input candidates

The runner used three frozen, ten-topic Wikimedia inputs. Web research remained live so that each candidate could retrieve timely supporting evidence.

### Fixture labeled August 24, 2026

- Source feed date: August 24, 2026
- Trending data date: August 23, 2026
- Stress mix: deaths, politics, films, sports, and unexplained traffic

### Fixture labeled August 18, 2026

- Source feed date: August 18, 2026
- Trending data date: August 17, 2026
- Stress mix: sports, entertainment, obscure topics, and uncertain causes

### Fixture labeled August 14, 2026

- Source feed date: August 13, 2026
- Trending data date: August 12, 2026
- Stress mix: eclipse coverage, politics, films, sports, and deaths
- The evaluation label intentionally preserves the requested August 14 fixture name. The one-day offset is explicit because the actual August 12 trending snapshot contained the requested eclipse mix.

Every candidate used medium reasoning. The eight approved candidates were evaluated against all three fixtures, producing 24 transcripts.

The blinded rubric weighted:

- Causal and contextual depth: 30 percent
- Factual support: 25 percent
- Topic coverage: 20 percent
- Spoken flow: 15 percent
- Target length: 10 percent

Unsupported causal claims, unlabeled uncertainty, fabricated sources, missing web research, and invalid output were hard-failure conditions. After implementation review, the candidate-letter report was regenerated from the same captured candidate outputs with operational fingerprints such as model cost, latency, token counts, and web-search counts withheld. Two fresh independent reviewers received only that report; they did not receive model or prompt identities.

## Candidate evidence and strict support outcomes

Costs below are approximate Standard-tier text and web-search costs per episode. They treat every input token as uncached and exclude speech generation.

The comparison uses headings and lists instead of a chart so exact values, hard-failure notes, and candidate order remain linear and easy to audit with a screen reader.

### Candidate A

- Configuration: Luna with the control prompt
- Average spoken words: 117; range 110–122
- Average web searches: 4.3
- Average sources: 6
- Average generation time: 43.7 seconds; maximum 50.6 seconds
- Approximate average cost: $0.054
- Combined raw blind score: 69.6
- One reviewer hard-failed an unlabeled causal claim connecting Jansen Panettiere coverage to cardiomegaly traffic. The second reviewer treated the same wording as sufficiently supported.

### Candidate B

- Configuration: Luna with depth writing and broad research
- Average spoken words: 334; range 303–364
- Average web searches: 4.0
- Average sources: 6
- Average generation time: 48.0 seconds; maximum 51.5 seconds
- Approximate average cost: $0.051
- Combined raw blind score: 81.0
- Both reviewers hard-failed the August 24 Awarapan explanation because its unsupported August 21 release claim conflicted with the August 14 evidence elsewhere in the report.

### Candidate C — selected

- Configuration: Luna with per-topic deep research and depth writing
- Average spoken words: 352.3; range 344–368
- Average web searches: 22.7
- Average sources: 15
- Average generation time: 50.9 seconds; maximum 52.5 seconds
- Approximate average cost: $0.281
- Combined blind score: 89.5
- Hard failures: none

### Candidate D

- Configuration: Terra with the control prompt
- Average spoken words: 109; range 102–114
- Average web searches: 4.3
- Average sources: 6
- Average generation time: 42.6 seconds; maximum 43.7 seconds
- Approximate average cost: $0.151
- Combined raw blind score: 65.5
- Both reviewers hard-failed the August 14 Britain-eclipse explanation because a source presented as BBC News resolved to an unrelated `pages.dev` domain.

### Candidate E

- Configuration: Terra with depth writing and broad research
- Average spoken words: 378.7; range 366–396
- Average web searches: 4.3
- Average sources: 6
- Average generation time: 52.9 seconds; maximum 63.1 seconds
- Approximate average cost: $0.154
- Combined raw blind score: 83.2
- One reviewer hard-failed a future-dated source used for the August 14 Joshua Kushner explanation. The second reviewer scored the evidence as thin without applying a hard failure.

### Candidate F

- Configuration: Terra with per-topic deep research and depth writing
- Average spoken words: 410.7; range 405–414
- Average web searches: 21.3
- Average sources: 15
- Average generation time: 55.5 seconds; maximum 64.0 seconds
- Approximate average cost: $0.743
- Combined raw blind score: 85.5
- Both reviewers hard-failed an unsupported Neatsville claim that described a Wikimedia user-profile URL as an investigation into newsletter or automated traffic.
- One transcript required the allowed writing-only length repair. Apart from the support failure above, reviewers found the result rich but denser and less conversational than the passing finalists.

### Candidate G

- Configuration: Sol with depth writing and broad research
- Average spoken words: 367.3; range 359–377
- Average web searches: 6.0
- Average sources: 6
- Average generation time: 91.5 seconds; maximum 120.6 seconds
- Approximate average cost: $0.347
- Combined blind score: 86.8
- Hard failures: none

### Candidate H

- Configuration: Sol with per-topic deep research and depth writing
- Average spoken words: 395; range 384–409
- Average web searches: 28.3
- Average sources: 15
- Average generation time: 101.5 seconds; maximum 108.8 seconds
- Approximate average cost: $1.387
- Combined blind score: 91.2
- Hard failures: none
- Both reviewers ranked H first on raw editorial quality, especially for causal calibration and subtle factual distinctions.

## The near-tie rule selects Candidate C

The strict passing ranking was H, C, G. Candidates A, B, D, E, and F each received at least one hard failure, so their raw scores were not eligible for winner selection. Scores for H, C, and G all fell within five points of the highest passing score.

The predeclared rule treats passing candidates in that band as finalists, then chooses lower cost and lower latency. Candidate C was both cheaper and faster than G and cost about one fifth as much as H while completing in about half the time. More importantly, it retained the deep-research structure that reviewers consistently associated with better factual support and uncertainty handling.

This result does not say that Sol has no quality advantage. It establishes Sol as a useful ceiling, but its roughly 1.7-point combined advantage over Luna deep research was not material enough to override the agreed near-tie rule. Terra produced strong raw work, but its best candidates did not pass the strict support audit.

## Per-topic research supplied the missing context

Per-topic research improved more than the raw source count suggests. Each topic gets one Responses API research pass with high search context and a four-topic concurrency limit. The research note must identify a trigger, timeline, background, confidence, and uncertainty.

A final implementation review caught a two-tool-call cap that had been added after the evaluation completed. That cap was removed before handoff, restoring the exact prompt and web-tool request body used for the measured candidates. The promoted prompt, search context, and uncapped per-topic pass therefore match the raw evaluation evidence. Post-evaluation deadline, cancellation, and no-retry options change only stalled or failed-call behavior; they do not alter the captured successful responses, so no replacement paid run was needed.

The evaluation exposed a provenance bug before promotion: truncating a flattened source list could spend most of the 15 slots on the first topic. Production now interleaves sources across topic research passes before deduplication and removes tracking-only URL variants from the deduplication identity. This keeps the reader-facing list representative without changing the underlying evidence supplied to the writer.

The final writer receives all ten research notes and up to 15 representative sources. It must cover all ten topics, but it can spend more time on the best-supported leaders. If a cause is not established, the prompt requires explicit uncertainty rather than a confident guess.

## A strict word band prevents another one-minute brief

Depth profiles require a 300–420-word `spokenSummary`. A result outside the band receives one writing-only repair using the existing research. The repair is not allowed to add claims. If the repaired script still misses the band, the job fails before narration or publication.

Across the 18 depth-profile outputs, two needed repair and both passed. All control outputs remained far below the target, which validates both the complaint and the need for a production gate.

## Mini and Marin met the two-to-three-minute target

The selected Candidate C transcript for every fixture was rendered locally through `gpt-4o-mini-tts` with the `marin` voice. The normal audible disclosure was prepended before speech generation.

- August 24 fixture: 389 total script words, 2,581 characters, 164.064 seconds
- August 18 fixture: 365 total script words, 2,467 characters, 147.768 seconds
- August 14 fixture: 366 total script words, 2,477 characters, 150.216 seconds

All three MP3s were valid according to `ffprobe`, used one speech chunk, and landed within the required 120–180-second range.

Trending speech is now pinned to the exact Mini/Marin profile. Trusted Trending requests forbid Edge fallback and bypass the interactive OpenAI quota through the existing signed background attestation. A quota, timeout, or provider failure returns an error, preserves any prior ready episode, and lets the second cron retry. Newly researched prose is persisted before artwork and speech, so a downstream failure can retry narration without paying to repeat successful research. Historical Edge episodes remain readable and unchanged.

## The runtime budget covers the bounded text workflow

The winning text profile took at most 52.5 seconds across the three evaluation fixtures. Sol deep research, the slowest deep profile, took at most 108.8 seconds. The slowest candidate of any kind took 120.6 seconds.

The Trending cron and manual sync routes now allow 800 seconds, and the Convex job lease is 15 minutes. Text generation has an 11-minute overall deadline, each OpenAI request is capped at 120 seconds with no SDK retry, and the first failed topic cancels its in-flight peers before the job returns. In the worst deep path, three research waves plus an initial write and one repair fit within ten minutes; the deadline remains a final backstop. That leaves more than two minutes of route time and four minutes of lease time for strict speech, artwork, uploads, and finalization before the second cron 30 minutes later.

## Merge next, then monitor the first scheduled episode

The next action is code review and merge of this branch. Deployment, forced regeneration, and historical backfill are intentionally outside this worktree task. After deployment, the first naturally scheduled episode should be checked for its persisted `briefPromptVersion`, Mini/Marin metadata, 300–420-word script, audible disclosure, and two-to-three-minute duration.

Ongoing monitoring should watch generation failures by stage, repair frequency, total web-search calls and estimated text cost, strict TTS failures, and whether the second cron is reusing persisted prose. A future re-evaluation is warranted if the model default, research prompt, pricing, or typical topic mix changes materially. Listener feedback on depth and pacing remains the most important evidence not captured by this offline evaluation.

## Reproducibility limits and caveats

The committed fixtures freeze Wikimedia titles, extracts, views, and dates. Web-search results are intentionally live, so a later rerun may retrieve different reporting and will not be byte-for-byte deterministic.

Exact-title coverage is a conservative automated measurement. It can undercount a topic that the narration identifies naturally without repeating the complete Wikipedia article title. Reviewers therefore used the transcript and research notes, not the exact-title metric alone.

The cost estimate uses current official Standard-tier rates, assumes no cached input discount, and adds the documented web-search call price. It is an estimate rather than an invoice. Speech costs are not included in the candidate comparison because every finalist uses the same final narration profile.

Structured evaluation JSON, research notes, blinded transcripts, and MP3s remain under the gitignored `.reports/trending-brief-eval/` directory. For this completed run, the JSON includes normalized research text, extracted sources, parsed briefs, usage, latency, and search counts; it does not include the provider response envelopes. The harness now captures those full provider responses for future runs without affecting production requests. The source-list-refreshed evaluation files are:

- `trending-brief-evaluation-2026-08-24T06-08-34-248Z.json`
- `trending-brief-evaluation-2026-08-24T06-08-34-248Z.md`

The operational-metric-free blind re-score files, generated from those same candidate responses with the explicit 300–420-word scoring target, are:

- `trending-brief-evaluation-2026-08-24T06-40-34-427Z.json`
- `trending-brief-evaluation-2026-08-24T06-40-34-427Z.md`

## Candidate identity appendix

- A: Luna, control
- B: Luna, depth writing
- C: Luna, deep research and depth writing
- D: Terra, control
- E: Terra, depth writing
- F: Terra, deep research and depth writing
- G: Sol, depth writing
- H: Sol, deep research and depth writing

## Official references

- [OpenAI GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6#prompting-best-practices)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI GPT-4o Mini TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- [Vercel Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
