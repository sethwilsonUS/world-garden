"use client";

import {
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  ContextBlock,
  ContextBlockKind,
  ContextChartBlock,
  ContextManifest,
} from "@/lib/article-context-types";
import type { ArticleContextLoadState } from "@/hooks/useArticleContext";
import {
  ContextChartView,
  ContextDiagramView,
  ContextMapView,
  ContextTimelineView,
} from "./ArticleContextVisuals";

const KIND_LABELS: Record<ContextBlockKind, string> = {
  map: "Map",
  timeline: "Timeline",
  chart: "Data",
  diagram: "Diagram",
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "note";

export const getContextBlockDomId = (block: Pick<ContextBlock, "id">): string =>
  `article-context-${slugify(block.id)}`;

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

export const ContextSectionLink = ({ blocks }: { blocks: ContextBlock[] }) => {
  if (blocks.length === 0) return null;
  const first = blocks[0];
  const targetId = getContextBlockDomId(first);
  const label = `${blocks.length} ${blocks.length === 1 ? "visual" : "visuals"}`;
  const destination = blocks.length === 1
    ? `${KIND_LABELS[first.kind].toLowerCase()}: ${first.title}`
    : `${KIND_LABELS[first.kind].toLowerCase()}: ${first.title}, plus ${blocks.length - 1} more`;
  const focusVisual = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus({ preventScroll: true });
    });
  };
  return (
    <a
      className="context-section-link"
      href={`#${targetId}`}
      aria-label={`${label}: jump to ${destination}`}
      onClick={focusVisual}
    >
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

const ContextKindView = ({
  block,
  captionId,
  descriptionId,
}: {
  block: ContextBlock;
  captionId: string;
  descriptionId: string;
}) => {
  switch (block.kind) {
    case "map":
      return <ContextMapView block={block} caption={block.caption} captionId={captionId} descriptionId={descriptionId} />;
    case "timeline":
      return <ContextTimelineView block={block} caption={block.caption} captionId={captionId} />;
    case "chart":
      return <ContextChartView block={block} caption={block.caption} captionId={captionId} />;
    case "diagram":
      return <ContextDiagramView block={block} caption={block.caption} captionId={captionId} descriptionId={descriptionId} />;
  }
};

const ContextCard = ({
  block,
  manifest,
}: {
  block: ContextBlock;
  manifest: ContextManifest;
}) => {
  const domId = getContextBlockDomId(block);
  const captionId = `${domId}-caption`;
  const descriptionId = `${domId}-description`;
  return (
    <article
      id={domId}
      tabIndex={-1}
      className={`context-card context-card-${block.kind}`}
      aria-labelledby={`${domId}-heading`}
      aria-describedby={`${captionId} ${descriptionId}`}
    >
      <header>
        <div className="context-eyebrow">
          <span className={`context-kind-mark context-kind-${block.kind}`}>
            <ContextGlyph kind={block.kind} />
            {KIND_LABELS[block.kind]}
          </span>
          <span>{block.section.index === "__summary__" ? "Article summary" : `From “${block.section.title}”`}</span>
          {block.sources[0] ? <span>Source: {block.sources[0].label}</span> : null}
        </div>
        <h3 id={`${domId}-heading`}>{block.title}</h3>
      </header>
      <ContextKindView block={block} captionId={captionId} descriptionId={descriptionId} />
      <p id={descriptionId} className="sr-only">{block.longDescription}</p>

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
}: {
  state: ArticleContextLoadState;
  retry: () => void;
}) => {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <section className="context-lane context-lane-loading" aria-labelledby="article-context-heading">
        <h2 id="article-context-heading">Visual context</h2>
        <p role="status">Gathering maps, timelines, data, and diagrams with accessible descriptions…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="context-lane context-lane-error" aria-labelledby="article-context-heading">
        <h2 id="article-context-heading">Visual context</h2>
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
          />
        ))}
      </div>
    </section>
  );
};
