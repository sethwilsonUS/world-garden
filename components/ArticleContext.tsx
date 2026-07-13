"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type {
  ArticleContextApiResponse,
  ArticleContextRequest,
  ContextBlock,
  ContextBlockKind,
  ContextChartBlock,
  ContextManifest,
} from "@/lib/article-context-types";
import {
  ContextChartView,
  ContextDiagramView,
  ContextMapView,
  ContextTimelineView,
} from "./ArticleContextVisuals";

export type ArticleContextLoadState =
  | { status: "idle" | "loading"; manifest: null; error: null }
  | { status: "ready"; manifest: ContextManifest; error: null }
  | { status: "error"; manifest: null; error: string };

export type ContextAudioDetail = "summary" | "description";

const KIND_LABELS: Record<ContextBlockKind, string> = {
  map: "Map",
  timeline: "Timeline",
  chart: "Data",
  diagram: "Diagram",
};

const KIND_ACTIONS: Record<ContextBlockKind, string> = {
  map: "Explore map and places",
  timeline: "Explore timeline",
  chart: "Explore chart and exact data",
  diagram: "Explore diagram",
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "note";

export const getContextBlockDomId = (block: Pick<ContextBlock, "id">): string =>
  `article-context-${slugify(block.id)}`;

export const getContextAudioKey = (
  block: ContextBlock,
  detail: ContextAudioDetail = "summary",
): string => {
  const hash = block.provenance.sourceHash.slice(0, 12);
  return `context-${detail}-${slugify(block.id)}-${hash}`;
};

export const getContextAudioDetail = (
  sectionKey: string | null | undefined,
): ContextAudioDetail | null => {
  if (sectionKey?.startsWith("context-summary-")) return "summary";
  if (sectionKey?.startsWith("context-description-")) return "description";
  return null;
};

export const isContextAudioKey = (
  sectionKey: string | null | undefined,
): sectionKey is string => getContextAudioDetail(sectionKey) !== null;

export const getContextBlocksForSection = (
  blocks: ContextBlock[],
  sectionIndex: number | null,
  sectionTitle?: string,
): ContextBlock[] => {
  if (sectionIndex === null) {
    return blocks.filter((block) => block.section.index === "__summary__");
  }

  const normalizedTitle = sectionTitle?.trim().toLocaleLowerCase();
  return blocks.filter(
    (block) =>
      block.section.index === String(sectionIndex + 1) ||
      (normalizedTitle && block.section.title.trim().toLocaleLowerCase() === normalizedTitle),
  );
};

const sortBlocks = (blocks: ContextBlock[]): ContextBlock[] =>
  [...blocks].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const isArticleContextApiResponse = (value: unknown): value is ArticleContextApiResponse => {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<ArticleContextApiResponse>;
  return Boolean(
    response.context &&
      typeof response.context === "object" &&
      Array.isArray(response.context.blocks),
  );
};

export const useArticleContext = (request: ArticleContextRequest | null) => {
  const requestKey = request
    ? `${request.wikiPageId}:${request.revisionId}:${request.language ?? "en"}`
    : "";
  const requestGeneration = useMemo(() => ({ requestKey }), [requestKey]);
  const [reloadToken, setReloadToken] = useState(0);
  const [keyedState, setKeyedState] = useState<{
    requestKey: string;
    requestGeneration: object;
    state: ArticleContextLoadState;
  }>(() => ({
    requestKey,
    requestGeneration,
    state: {
      status: request ? "loading" : "idle",
      manifest: null,
      error: null,
    },
  }));

  useEffect(() => {
    if (!request) return;

    const controller = new AbortController();
    fetch("/api/article-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Context notes are temporarily unavailable.";
          throw new Error(message);
        }
        if (!isArticleContextApiResponse(body)) {
          throw new Error("Context notes returned an unexpected response.");
        }
        return body.context;
      })
      .then((manifest) => {
        if (controller.signal.aborted) return;
        setKeyedState({
          requestKey,
          requestGeneration,
          state: {
            status: "ready",
            manifest: { ...manifest, blocks: sortBlocks(manifest.blocks) },
            error: null,
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setKeyedState({
          requestKey,
          requestGeneration,
          state: {
            status: "error",
            manifest: null,
            error: error instanceof Error ? error.message : "Context notes are temporarily unavailable.",
          },
        });
      });

    return () => controller.abort();
    // requestKey intentionally expresses the stable request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, reloadToken]);

  const retry = useCallback(() => {
    if (!requestKey) return;
    setKeyedState({
      requestKey,
      requestGeneration,
      state: { status: "loading", manifest: null, error: null },
    });
    setReloadToken((value) => value + 1);
  }, [requestGeneration, requestKey]);
  const effectiveState: ArticleContextLoadState =
    keyedState.requestKey === requestKey &&
    keyedState.requestGeneration === requestGeneration
      ? keyedState.state
      : request
        ? { status: "loading", manifest: null, error: null }
        : { status: "idle", manifest: null, error: null };
  return { ...effectiveState, retry };
};

const ContextGlyph = ({ kind }: { kind: ContextBlockKind }) => {
  if (kind === "map") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2Z" />
        <path d="M8 4v13M16 7v13" />
      </svg>
    );
  }
  if (kind === "timeline") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 4v16M5 7h7M5 12h11M5 17h8" />
        <circle cx="5" cy="7" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="5" cy="17" r="1.5" />
      </svg>
    );
  }
  if (kind === "chart") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 20V5M4 20h17M7 16l4-5 4 2 5-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="7" height="5" rx="1" /><rect x="14" y="15" width="7" height="5" rx="1" />
      <path d="M10 6.5h3a3 3 0 0 1 3 3V15M8 9v4a3 3 0 0 0 3 3h3" />
    </svg>
  );
};

export const ArticleContextIndex = ({
  blocks,
  loading = false,
}: {
  blocks: ContextBlock[];
  loading?: boolean;
}) => {
  if (loading) {
    return <p className="context-index-loading">Looking for accessible context notes…</p>;
  }
  if (blocks.length === 0) return null;

  return (
    <details id="article-context-index" className="context-index">
      <summary>
        <span className="context-index-summary">
          <span className="context-index-sprig" aria-hidden="true">✦</span>
          Context notes
          <span className="context-count">{blocks.length}</span>
        </span>
        <span className="context-index-hint">Maps, timelines, data, and diagrams</span>
      </summary>
      <nav aria-label="Context notes in this article">
        <ol>
          {blocks.map((block) => (
            <li key={block.id}>
              <a href={`#${getContextBlockDomId(block)}`}>
                <span className={`context-kind-mark context-kind-${block.kind}`}>
                  <ContextGlyph kind={block.kind} />
                  {KIND_LABELS[block.kind]}
                </span>
                <span>
                  <strong>{block.title}</strong>
                  <small>{block.section.index === "__summary__" ? "Article summary" : block.section.title}</small>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
};

export const ContextSectionLink = ({ blocks }: { blocks: ContextBlock[] }) => {
  if (blocks.length === 0) return null;
  const label = `${blocks.length} context ${blocks.length === 1 ? "note" : "notes"}`;
  return (
    <a className="context-section-link" href={`#${getContextBlockDomId(blocks[0])}`}>
      <span aria-hidden="true">✦</span>
      {label}
    </a>
  );
};

const downloadFile = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const chartToCsv = (block: ContextChartBlock): string => {
  const escape = (value: unknown): string => {
    const raw = value == null ? "" : String(value);
    const text =
      typeof value === "string" && /^\s*[=+@-]/.test(value)
        ? `'${raw}`
        : raw;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = block.chart.columns.map((column) => escape(column.label)).join(",");
  const rows = block.chart.rows.map((row) => block.chart.columns.map((column) => escape(row[column.key])).join(","));
  return [header, ...rows].join("\n");
};

const ContextSources = ({ block }: { block: ContextBlock }) => (
  <details className="context-sources">
    <summary>Sources and provenance</summary>
    <ul>
      {block.sources.map((source, index) => (
        <li key={`${source.url}-${index}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.label}<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {source.revisionId ? <span>Revision {source.revisionId}</span> : null}
          {source.license ? <span>{source.license}</span> : null}
        </li>
      ))}
    </ul>
    <p>
      Based on the saved Wikipedia revision. Description: {block.provenance.descriptionMethod === "ai-assisted" ? "AI-assisted from cited source material" : "generated from structured source material"}.
      {block.provenance.model ? ` Model: ${block.provenance.model}.` : ""}
      {block.provenance.editorialOverride
        ? " Curio Garden applied an owner-reviewed accessibility-copy override."
        : ""}
    </p>
    <a href={block.provenance.articleRevisionUrl} target="_blank" rel="noopener noreferrer" className="context-text-link">
      Open the exact article revision<span className="sr-only"> (opens in a new tab)</span>
    </a>
  </details>
);

type ReportReason = "incorrect" | "inaccessible" | "confusing" | "other";

const ContextReportForm = ({
  block,
  manifest,
}: {
  block: ContextBlock;
  manifest: ContextManifest;
}) => {
  const [reason, setReason] = useState<ReportReason>("incorrect");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const formId = `context-report-${slugify(block.id)}`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    try {
      const response = await fetch("/api/article-context/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wikiPageId: manifest.wikiPageId,
          revisionId: manifest.revisionId,
          blockId: block.id,
          sourceHash: block.provenance.sourceHash,
          reason,
          details: details.trim(),
        }),
      });
      if (!response.ok) throw new Error("Report was not accepted");
      setDetails("");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <details className="context-report">
      <summary>Report a problem</summary>
      <form onSubmit={submit}>
        <label htmlFor={`${formId}-reason`}>What went wrong?</label>
        <select id={`${formId}-reason`} value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
          <option value="incorrect">Information appears incorrect</option>
          <option value="inaccessible">Something is difficult to use</option>
          <option value="confusing">The description is confusing</option>
          <option value="other">Something else</option>
        </select>
        <label htmlFor={`${formId}-details`}>
          Details <span>{reason === "other" ? "(required)" : "(optional)"}</span>
        </label>
        <textarea
          id={`${formId}-details`}
          value={details}
          maxLength={2000}
          rows={3}
          required={reason === "other"}
          onChange={(event) => setDetails(event.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Send report"}
        </button>
        <p className="context-status" role="status" aria-live="polite">
          {status === "sent" ? "Thank you. The context note was reported." : status === "error" ? "The report could not be sent. Please try again." : ""}
        </p>
      </form>
    </details>
  );
};

const ContextListenButton = ({
  block,
  detail,
  activeAudioKey,
  playbackStatus,
  onListen,
}: {
  block: ContextBlock;
  detail: ContextAudioDetail;
  activeAudioKey?: string | null;
  playbackStatus?: "idle" | "loading" | "playing" | "paused" | "error";
  onListen?: (block: ContextBlock, detail: ContextAudioDetail) => void;
}) => {
  if (!onListen) return null;
  const audioKey = getContextAudioKey(block, detail);
  const active = activeAudioKey === audioKey;
  const state = active ? playbackStatus : "idle";
  const label = detail === "summary" ? "Listen to context" : "Listen to full description";
  const visible = state === "loading" ? "Loading…" : state === "playing" ? "Pause" : state === "paused" ? "Resume" : label;
  return (
    <button
      type="button"
      className={detail === "summary" ? "btn-primary context-listen" : "btn-secondary context-listen"}
      onClick={() => onListen(block, detail)}
      aria-label={`${visible}: ${block.title}`}
      aria-pressed={active && (state === "playing" || state === "paused") ? true : undefined}
      disabled={state === "loading"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {state === "playing" ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="m7 4 13 8-13 8Z" />}
      </svg>
      <span>{visible}</span>
    </button>
  );
};

const ContextKindView = ({ block }: { block: ContextBlock }) => {
  switch (block.kind) {
    case "map":
      return <ContextMapView block={block} />;
    case "timeline":
      return <ContextTimelineView block={block} />;
    case "chart":
      return <ContextChartView block={block} />;
    case "diagram":
      return <ContextDiagramView block={block} />;
  }
};

const ContextCard = ({
  block,
  manifest,
  activeAudioKey,
  playbackStatus,
  onListen,
}: {
  block: ContextBlock;
  manifest: ContextManifest;
  activeAudioKey?: string | null;
  playbackStatus?: "idle" | "loading" | "playing" | "paused" | "error";
  onListen?: (block: ContextBlock, detail: ContextAudioDetail) => void;
}) => {
  const domId = getContextBlockDomId(block);
  return (
    <article id={domId} className={`context-card context-card-${block.kind}`} aria-labelledby={`${domId}-heading`}>
      <a href="#article-context-index" className="context-return-link">Return to context index</a>
      <header>
        <div className="context-eyebrow">
          <span className={`context-kind-mark context-kind-${block.kind}`}>
            <ContextGlyph kind={block.kind} />
            {KIND_LABELS[block.kind]}
          </span>
          <span>{block.section.index === "__summary__" ? "Article summary" : `From “${block.section.title}”`}</span>
        </div>
        <h3 id={`${domId}-heading`}>{block.title}</h3>
        <p className="context-takeaway"><strong>Why it matters:</strong> {block.takeaway}</p>
      </header>

      <div className="context-audio-row">
        <ContextListenButton
          block={block}
          detail="summary"
          activeAudioKey={activeAudioKey}
          playbackStatus={playbackStatus}
          onListen={onListen}
        />
        <p>{block.spokenSummary}</p>
      </div>

      <div className="context-description-row">
        <p className="context-long-description">{block.longDescription}</p>
        <ContextListenButton
          block={block}
          detail="description"
          activeAudioKey={activeAudioKey}
          playbackStatus={playbackStatus}
          onListen={onListen}
        />
      </div>

      <details className="context-explorer">
        <summary>{KIND_ACTIONS[block.kind]}</summary>
        <ContextKindView block={block} />
      </details>

      <div className="context-card-footer">
        <div className="context-downloads" aria-label={`Download data for ${block.title}`}>
          <button
            type="button"
            onClick={() => downloadFile(`${slugify(block.title)}.json`, JSON.stringify(block, null, 2), "application/json")}
          >
            Download JSON
          </button>
          {block.kind === "chart" ? (
            <button
              type="button"
              onClick={() => downloadFile(`${slugify(block.title)}.csv`, chartToCsv(block), "text/csv;charset=utf-8")}
            >
              Download CSV
            </button>
          ) : null}
        </div>
        <ContextSources block={block} />
        <ContextReportForm block={block} manifest={manifest} />
      </div>
    </article>
  );
};

export const ArticleContextLane = ({
  state,
  retry,
  activeAudioKey,
  playbackStatus,
  onListen,
}: {
  state: ArticleContextLoadState;
  retry: () => void;
  activeAudioKey?: string | null;
  playbackStatus?: "idle" | "loading" | "playing" | "paused" | "error";
  onListen?: (block: ContextBlock, detail: ContextAudioDetail) => void;
}) => {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <section className="context-lane context-lane-loading" aria-labelledby="article-context-heading">
        <h2 id="article-context-heading">Context notes</h2>
        <p role="status">Gathering maps, timelines, data, and diagrams with accessible descriptions…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="context-lane context-lane-error" aria-labelledby="article-context-heading">
        <h2 id="article-context-heading">Context notes</h2>
        <p>{state.error}</p>
        <button type="button" className="btn-secondary" onClick={retry}>Try context again</button>
      </section>
    );
  }
  if (state.status !== "ready" || !state.manifest) return null;
  if (state.manifest.blocks.length === 0) return null;
  const manifest = state.manifest;

  return (
    <section className="context-lane" aria-labelledby="article-context-heading">
      <div className="context-lane-heading">
        <span className="context-lane-kicker">Field notes</span>
        <h2 id="article-context-heading">Context that rewards a closer look</h2>
        <p>Visual views are paired with descriptions and structured data, so every path through the material carries the same meaning.</p>
      </div>
      <div className="context-card-list">
        {manifest.blocks.map((block) => (
          <ContextCard
            key={block.id}
            block={block}
            manifest={manifest}
            activeAudioKey={activeAudioKey}
            playbackStatus={playbackStatus}
            onListen={onListen}
          />
        ))}
      </div>
    </section>
  );
};
