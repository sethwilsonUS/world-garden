# ADR 0004: Account-bound native listening progress contract

- Status: Accepted
- Date: 2026-08-11
- Owners: Curio Garden maintainers

## Context

The native Article player can play a complete article queue and individual
sections, but it has no canonical resume target after a process restart or on a
second signed-in device. The existing `viewerArticleListenProgress` record owns
account-bound heard ranges, badge qualification, and cost-observation state. A
second progress table would split the account lifecycle and make export,
deletion, and concurrent writes harder to reason about.

Progress writes also need to survive retries and races between devices without
trusting a device clock or exposing one account's position after sign-out or an
account switch. The production web player must retain its existing behavior
while the native consumer is introduced in a later, bounded change.

## Decision

Extend the existing account-owned article-progress record with an optional live
resume cursor and a monotonically increasing cursor version. The platform-neutral
client cursor contains only playback identity and position:

- canonical MediaWiki page and revision identifiers;
- the positive narration version;
- playback mode, either complete-article `all` or one-section `single`;
- canonical summary or numbered-section key;
- integer position and duration in media seconds.

The server validates the cursor against the current stored article and applies
bounded domain normalization. It attaches the accepted server cursor version
and server timestamp; clients cannot supply either value. The row's page ID and
row-level cursor version reconstruct the portable public cursor rather than
being duplicated inside its stored resume target. Reads and writes are bound to
the authenticated native account subject and carry the opaque native session
epoch so an older response can be discarded after an account or session change.

A mutation supplies the version it observed. A matching write increments the
server version. A mismatched write is stale and returns the current state rather
than replacing it. Completion or an explicit start-over clears the live resume
target while still advancing and retaining the row-level version, so a delayed
older write cannot resurrect cleared progress. This mutation is deliberately
cursor-only: it does not write heard ranges, badge qualification, cost-ledger
state, or meaningful-use accumulation. Existing web mutations retain those
responsibilities unchanged; native heard-range reporting and its interaction
with those systems require a separately reviewed consumer contract.

When a first cursor or clear tombstone creates an article-progress row, the
server derives the row's required total article duration from the current
progress-counting narration tracks using the established deterministic speech
estimate. It never substitutes the current track duration or trusts a client
article-total value. Existing rows retain their previously measured total.

The account-data export includes a live cursor, when present, as an explicit
allowlisted projection:

```text
wikiPageId, revisionId, narrationVersion, mode, sectionKey,
positionSeconds, durationSeconds, cursorVersion, updatedAt
```

Legacy rows and cleared/completed rows omit `resumeCursor`; the internal version
tombstone is not exported as a resumable position. Because the cursor belongs to
the existing progress row, the established account deletion flow removes it.
The privacy policy names the latest saved section and position, cross-device
resume purpose, export inclusion, and deletion behavior.

## Consequences

The native data adapter is also UI-free. It performs one-shot, on-demand reads,
serializes compare-and-swap writes per opened article session, and exposes only
the normalized cursor plus `save` and `clear` operations. Account subjects,
session-epoch keys, server timestamps, and cursor versions remain private to the
audited adapter. An account switch or provider teardown supersedes pending and
queued work before an older cursor can be exposed; a stale identical write
converges, while a stale different write freezes that session as a conflict
until the caller reopens it.

A following native player consumer may reconcile native status snapshots and
lifecycle transitions through that adapter without widening the server or
account-data interfaces. It must present an explicit, accessible Resume or Start
Over choice where product behavior requires one. It must also make a deliberate
integration decision before native playback contributes heard ranges, badges,
meaningful-use state, or cost-ledger observations; this cursor mutation must not
be treated as an atomic replacement for the existing progress writer.

This decision does not add downloaded audio, offline article storage, background
JavaScript timers, a global Player route, push notifications, or a web-player
behavior change. Device-local crash recovery for a signed-out user, if desired,
needs a separately reviewed persistence and privacy decision. Reliable process
termination and physical VoiceOver/TalkBack behavior remain signed-build
acceptance gates; server contract tests cannot prove them.

## References

- [ADR 0001: Expo native sidecar](./0001-expo-native-sidecar.md)
- [ADR 0003: Native playlist media session foundation](./0003-native-playlist-media-session.md)
- [Native accessibility conventions](../native-accessibility-conventions.md)
- [Native accessibility test matrix](../mobile-accessibility-test-matrix.md)
