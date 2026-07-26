# Semantic MediaWiki document boundary

This module is the only place where MediaWiki HTML becomes application data.
Consumers receive the closed, serializable IR in `types.ts`; they never inspect
HTML, `data-mw`, or parse5 nodes.

## Source order

1. Fetch the requested `oldid` with Parsoid and validate page, title, and
   revision identity.
2. Retry legacy parsed HTML only when Parsoid is explicitly rejected or does
   not provide semantic section wrappers.
3. Use the caller's revision-matched plaintext when structured parsing is
   unavailable, violates a safety limit, cannot align by exact section
   index/title, or contains an unsupported narration-affecting structure.

Identity mismatches are always fatal. Network, abort, size, and identity
failures never trigger an extra legacy request.

## Parsing rules

- Section, paragraph, list, table, figure, link, and citation structure comes
  from the HTML tree—not text density, sentence counts, numeric ratios, or tag
  regexes.
- Lists recurse through semantic list elements.
- Tables are normalized through an occupancy grid. Spans, row groups,
  `scope`, and explicit `headers` relationships are resolved before a table is
  exposed. Invalid tables are atomic: no partial rows leak into the IR.
- `data-mw` JSON is decoded once into a bounded, canonical JSON value. Only the
  closed extension variants in `types.ts` can cross the boundary.
- Mini-language parsing is confined to the extension that owns that grammar
  (EasyTimeline and OSM marker coordinates). No whole-page wikitext scan is
  performed.
- Non-content Parsoid extensions such as references and TemplateStyles are
  ignored. Source-bearing poem extensions become prose.

## Safety limits

| Surface               |                                             Limit |
| --------------------- | ------------------------------------------------: |
| HTTP response         |                                  15 MiB, streamed |
| DOM traversal         |                         500,000 nodes / depth 128 |
| Table                 | 2,000 rows / 128 columns / 100,000 expanded cells |
| One `data-mw` payload |                           750 KiB / JSON depth 64 |
| Map geometry          |                      50,000 coordinates / depth 8 |

`auditSourceLocations` is accepted for audit callers, but production parsing
does not enable parse5 source locations and offsets never enter the IR.

## Regression strategy

Tests enter through `loadMediaWikiDocument` with an injected `fetchImpl`.
Alongside examples, fixed-seed generated table partitions exercise grid and
span invariants. Canonical hashes deliberately ignore comments, whitespace,
attribute order, and DOM offsets while including parser version, revision
identity, ordered section identity, and canonical semantic content.
