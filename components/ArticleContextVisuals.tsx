"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTheme } from "./ThemeProvider";
import type {
  ContextChartBlock,
  ContextChartSeries,
  ContextDiagramBlock,
  ContextTimelineBlock,
} from "@/lib/article-context-types";
import {
  formatContextChartCell,
  getContextChartPayloadKey,
  getOrdinalPositionPresentation,
  getRankedBarGeometry,
  getRankedChartPresentation,
  getStandardChartFamilyView,
  getStandardChartPresentation,
  shouldStandardChartUseZeroBaseline,
  type RankedChartPresentation,
  type OrdinalPositionPresentation,
  type StandardChartRenderKind,
} from "@/lib/article-context-chart";
import type { ECharts, EChartsOption } from "echarts";
import {
  StructuredDataDisclosure,
  countLabel,
  isReducedMotion,
  useMediaQuery,
  useNearViewport,
} from "./ArticleContextVisualShared";
const MOBILE_CHART_MEDIA_QUERY = "(max-width: 640px)";

export {
  ContextMapView,
  MapSchematic,
  fitMapToFeatures,
  getMapFeatureBounds,
  type ContextMapFeatureBounds,
} from "./ArticleContextMap";

export const ContextTimelineView = ({
  block,
  caption,
  captionId,
}: {
  block: ContextTimelineBlock;
  caption: string;
  captionId: string;
}) => {
  const categories = useMemo(
    () => Array.from(new Set(block.timeline.events.map((event) => event.category).filter((value): value is string => Boolean(value)))),
    [block.timeline.events],
  );
  const [category, setCategory] = useState("all");
  const [ascending, setAscending] = useState(block.timeline.chronological);
  const events = useMemo(() => {
    const selected = category === "all"
      ? block.timeline.events
      : block.timeline.events.filter((event) => event.category === category);
    return [...selected].sort((a, b) => ascending ? a.start.sortKey - b.start.sortKey : b.start.sortKey - a.start.sortKey);
  }, [ascending, block.timeline.events, category]);

  return (
    <div className="context-kind-view">
      <div className="context-timeline-controls">
        {categories.length > 1 ? (
          <label>
            Show category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : null}
        <button type="button" className="btn-secondary" onClick={() => setAscending((value) => !value)}>
          {ascending ? "Newest first" : "Oldest first"}
        </button>
      </div>
      <p className="context-status" role="status" aria-live="polite">
        {events.length} {events.length === 1 ? "event" : "events"}, {ascending ? "oldest first" : "newest first"}
      </p>
      <ol className="context-timeline-list">
        {events.map((event) => (
          <li key={event.id}>
            <div className="context-timeline-date">
              {event.start.iso ? <time dateTime={event.start.iso}>{event.start.display}</time> : <span>{event.start.display}</span>}
              {event.end ? (
                <>
                  <span aria-hidden="true"> — </span>
                  <span className="sr-only"> through </span>
                  {event.end.iso ? <time dateTime={event.end.iso}>{event.end.display}</time> : <span>{event.end.display}</span>}
                </>
              ) : null}
            </div>
            <div className="context-timeline-copy">
              <strong>{event.label}</strong>
              {event.category ? <span className="context-category">{event.category}</span> : null}
              {event.description ? <p>{event.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p id={captionId} className="context-visual-caption">
        {caption}
      </p>
    </div>
  );
};

const numericValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const buildLinePath = (
  rows: ContextChartBlock["chart"]["rows"],
  series: ContextChartSeries,
  min: number,
  max: number,
): string => {
  const span = max - min || 1;
  return rows.reduce((path, row, index) => {
    const value = numericValue(row[series.yColumn]);
    if (value === null) return path;
    const x = 54 + (index / Math.max(rows.length - 1, 1)) * 550;
    const y = 24 + (1 - (value - min) / span) * 190;
    const previousValue = index > 0 ? numericValue(rows[index - 1][series.yColumn]) : null;
    return `${path}${path ? " " : ""}${previousValue === null ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }, "");
};

const CHART_COLORS = {
  light: ["#047857", "#b45309", "#2563eb", "#a21caf", "#be123c", "#4d7c0f"],
  dark: ["#34d399", "#f2ad5d", "#75a7e8", "#c99ae0", "#fb7185", "#a3e635"],
} as const;
const CHART_LINE_STYLES = ["solid", "dashed", "dotted"] as const;
const CHART_SYMBOLS = ["circle", "rect", "triangle", "diamond", "pin", "arrow"] as const;
const FALLBACK_CHART_TOP = 24;
const FALLBACK_CHART_HEIGHT = 190;

const fallbackChartY = (value: number, min: number, max: number): number => {
  const span = max - min || 1;
  return (
    FALLBACK_CHART_TOP +
    (1 - (value - min) / span) * FALLBACK_CHART_HEIGHT
  );
};

export const getFallbackBarGeometry = (
  value: number,
  min: number,
  max: number,
): { y: number; height: number; zeroY: number } => {
  const valueY = fallbackChartY(value, min, max);
  const zeroY = fallbackChartY(0, min, max);
  return {
    y: Math.min(valueY, zeroY),
    height: Math.abs(valueY - zeroY),
    zeroY,
  };
};

const ChartGraphic = ({
  block,
  rows,
  renderKind,
  selectedSeries,
  zeroBaseline,
}: {
  block: ContextChartBlock;
  rows: ContextChartBlock["chart"]["rows"];
  renderKind: Exclude<StandardChartRenderKind, "exact-only">;
  selectedSeries: ContextChartSeries[];
  zeroBaseline: boolean;
}) => {
  const { theme } = useTheme();
  const chartColors = CHART_COLORS[theme];
  const values = selectedSeries.flatMap((series) =>
    rows.map((row) => numericValue(row[series.yColumn])).filter((value): value is number => value !== null),
  );
  const dataMin = values.length > 0 ? Math.min(...values) : 0;
  const dataMax = values.length > 0 ? Math.max(...values) : 0;
  const min = zeroBaseline ? Math.min(0, dataMin) : dataMin;
  const max = zeroBaseline ? Math.max(0, dataMax) : dataMax;
  const zeroY = fallbackChartY(0, min, max);

  return (
      <svg viewBox="0 0 640 260" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
        <defs>
          {selectedSeries.map((series, seriesIndex) => {
            const color = chartColors[seriesIndex % chartColors.length];
            return (
              <pattern
                key={series.id}
                id={`context-chart-pattern-${block.id}-${series.id}`}
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${seriesIndex * 45})`}
              >
                <rect width="8" height="8" fill={color} />
                {seriesIndex > 0 ? (
                  <path
                    d="M 0 0 L 0 8"
                    stroke={theme === "dark" ? "#111827" : "#ffffff"}
                    strokeOpacity="0.62"
                    strokeWidth={Math.min(3, seriesIndex + 1)}
                  />
                ) : null}
              </pattern>
            );
          })}
        </defs>
        <rect width="640" height="260" rx="14" className="context-chart-paper" />
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={line} x1="54" x2="604" y1={24 + line * 47.5} y2={24 + line * 47.5} className="context-chart-grid" />
        ))}
        <line x1="54" x2="54" y1="24" y2="214" className="context-chart-axis" />
        <line x1="54" x2="604" y1={zeroY} y2={zeroY} className="context-chart-axis" />
        {selectedSeries.map((series, seriesIndex) => {
          const color = chartColors[seriesIndex % chartColors.length];
          if (renderKind === "bar" || renderKind === "pie") {
            const slotWidth = 550 / Math.max(rows.length, 1);
            const barWidth = Math.max(2, (slotWidth * 0.72) / Math.max(selectedSeries.length, 1));
            return rows.map((row, rowIndex) => {
              const value = numericValue(row[series.yColumn]);
              if (value === null) return null;
              const geometry = getFallbackBarGeometry(value, min, max);
              return (
                <rect
                  key={`${series.id}-${rowIndex}`}
                  x={54 + rowIndex * slotWidth + seriesIndex * barWidth + slotWidth * 0.14}
                  y={geometry.y}
                  width={barWidth}
                  height={geometry.height}
                  fill={`url(#context-chart-pattern-${block.id}-${series.id})`}
                  className={renderKind === "pie" ? "context-chart-pie-bar" : undefined}
                />
              );
            });
          }
          const path = buildLinePath(rows, series, min, max);
          return (
            <g key={series.id}>
              {series.type === "area" && renderKind === "line" ? (
                <path d={`${path} L604 ${zeroY} L54 ${zeroY} Z`} fill={color} opacity="0.18" />
              ) : null}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeDasharray={seriesIndex === 0 ? undefined : seriesIndex % 2 === 0 ? "3 5" : "10 6"}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
  );
};

const EChartsGraphic = ({
  block,
  rows,
  renderKind,
  selectedSeries,
  zeroBaseline,
}: {
  block: ContextChartBlock;
  rows: ContextChartBlock["chart"]["rows"];
  renderKind: Exclude<StandardChartRenderKind, "exact-only">;
  selectedSeries: ContextChartSeries[];
  zeroBaseline: boolean;
}) => {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const nearViewport = useNearViewport(containerRef);
  const {
    matches: narrowViewport,
    revision: viewportRevision,
  } = useMediaQuery(MOBILE_CHART_MEDIA_QUERY);
  const [failed, setFailed] = useState(false);
  const [readyAttempt, setReadyAttempt] = useState<string | null>(null);
  const xColumn = selectedSeries[0]?.xColumn ?? block.chart.columns[0]?.key ?? "";
  const xLabels = useMemo(
    () => rows.map((row) => String(row[xColumn] ?? "Not available")),
    [rows, xColumn],
  );
  const horizontalBars =
    selectedSeries.length > 0 &&
    renderKind === "bar" &&
    (rows.length > 8 || xLabels.some((label) => label.length > 16));
  const chartHeight = horizontalBars
    ? Math.min(560, Math.max(320, rows.length * 34 + (selectedSeries.length > 1 ? 66 : 48)))
    : 300;
  const chartPayloadKey = getContextChartPayloadKey(rows, selectedSeries);
  const chartAttempt = `${block.provenance.sourceHash}:${block.id}:${theme}:${chartPayloadKey}:${horizontalBars}:${renderKind}:${zeroBaseline}:${narrowViewport}:${viewportRevision}`;
  const ready = readyAttempt === chartAttempt;

  useEffect(() => {
    const container = containerRef.current;
    const useMobileBarLayout = horizontalBars && narrowViewport;
    if (!container || !nearViewport || useMobileBarLayout) return;
    let chart: ECharts | null = null;
    let cancelled = false;

    import("echarts")
      .then((echarts) => {
        if (cancelled) return;
        chart = echarts.init(container, undefined, { renderer: "svg" });
        const styles = getComputedStyle(container);
        const textColor = styles.getPropertyValue("--color-foreground-2").trim() ||
          (theme === "dark" ? "#d1d5db" : "#374151");
        const borderColor = styles.getPropertyValue("--color-border").trim() ||
          (theme === "dark" ? "#374151" : "#d1d5db");
        const valueAxis = {
          type: "value" as const,
          scale: !zeroBaseline,
          axisLabel: { color: textColor },
          axisLine: { lineStyle: { color: borderColor } },
          splitLine: { lineStyle: { color: borderColor } },
        };
        const categoryAxis = {
          type: "category" as const,
          data: xLabels,
          axisLabel: { hideOverlap: !horizontalBars, color: textColor },
          axisLine: { lineStyle: { color: borderColor } },
          axisTick: { lineStyle: { color: borderColor } },
        };
        const option: EChartsOption = {
          animation: !isReducedMotion(),
          animationDuration: 350,
          color: [...CHART_COLORS[theme]],
          backgroundColor: "transparent",
          textStyle: { color: textColor },
          grid: horizontalBars
            ? { left: 24, right: 34, top: selectedSeries.length > 1 ? 48 : 18, bottom: 24, containLabel: true }
            : { left: 54, right: 22, top: selectedSeries.length > 1 ? 54 : 28, bottom: 54, containLabel: true },
          legend: selectedSeries.length > 1
            ? {
                show: true,
                top: 4,
                type: "scroll",
                textStyle: { color: textColor },
              }
            : { show: false },
          tooltip: { show: false },
          xAxis: horizontalBars ? valueAxis : categoryAxis,
          yAxis: horizontalBars
            ? { ...categoryAxis, inverse: true }
            : valueAxis,
          series: selectedSeries.map((series, seriesIndex) => {
            const decal = {
              symbol: CHART_SYMBOLS[seriesIndex % CHART_SYMBOLS.length],
              symbolSize: 0.65,
              color: theme === "dark"
                ? "rgba(17, 24, 39, 0.55)"
                : "rgba(255, 255, 255, 0.62)",
              dashArrayX: [1, 0],
              dashArrayY: [3 + (seriesIndex % 3), 3],
              rotation: (seriesIndex * Math.PI) / 4,
            };
            if (renderKind === "pie") {
              return {
                id: series.id,
                name: series.label,
                cursor: "default",
                silent: true,
                type: "pie" as const,
                radius: ["35%", "68%"],
                data: rows
                  .map((row, index): { name: string; value: number } | null => {
                    const value = numericValue(row[series.yColumn]);
                    return value === null ? null : { name: xLabels[index], value };
                  })
                  .filter((item): item is { name: string; value: number } => item !== null),
                label: { show: true, formatter: "{b}", color: textColor },
                itemStyle: { decal },
              };
            }
            return {
              id: series.id,
              name: series.label,
              cursor: "default",
              silent: true,
              type: renderKind === "bar" ? "bar" as const : "line" as const,
              data: rows.map((row) => numericValue(row[series.yColumn])),
              connectNulls: false,
              showSymbol: rows.length <= 30,
              symbol: CHART_SYMBOLS[seriesIndex % CHART_SYMBOLS.length],
              lineStyle: {
                type: CHART_LINE_STYLES[seriesIndex % CHART_LINE_STYLES.length],
              },
              itemStyle: renderKind === "bar" ? { decal } : undefined,
              areaStyle: renderKind === "line" && series.type === "area"
                ? { opacity: 0.18 }
                : undefined,
              emphasis: { disabled: true },
            };
          }),
        };
        chart.setOption(option);
        if (!cancelled) setReadyAttempt(chartAttempt);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(resize)
      : null;
    resizeObserver?.observe(container);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [block, chartAttempt, horizontalBars, narrowViewport, nearViewport, renderKind, rows, selectedSeries, theme, xLabels, zeroBaseline]);

  return (
    <div className={horizontalBars ? "context-responsive-horizontal-bars" : undefined}>
      <div className="context-desktop-chart">
        {failed ? (
          <ChartGraphic
            block={block}
            rows={rows}
            renderKind={renderKind}
            selectedSeries={selectedSeries}
            zeroBaseline={zeroBaseline}
          />
        ) : (
          <div className="context-echarts-surface" aria-busy={!ready}>
            <div
              ref={containerRef}
              className="context-echarts"
              aria-hidden="true"
              style={{ minHeight: chartHeight }}
            />
            {!ready ? (
              <p className="context-rich-media-placeholder">
                {nearViewport
                  ? "Loading chart."
                  : "Chart will load as it approaches the viewport."}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {horizontalBars ? (
        <MobileCategoryBars
          block={block}
          rows={rows}
          selectedSeries={selectedSeries}
          xColumn={xColumn}
          theme={theme}
        />
      ) : null}
    </div>
  );
};

const MobileCategoryBars = ({
  block,
  rows,
  selectedSeries,
  xColumn,
  theme,
}: {
  block: ContextChartBlock;
  rows: ContextChartBlock["chart"]["rows"];
  selectedSeries: ContextChartSeries[];
  xColumn: string;
  theme: "light" | "dark";
}) => {
  const values = selectedSeries.flatMap((series) =>
    rows.map((row) => row[series.yColumn]),
  );
  const categoryColumn = block.chart.columns.find(
    (column) => column.key === xColumn,
  );
  const showSeriesLabels = selectedSeries.length > 1;

  return (
    <ol
      className="context-mobile-category-bars"
      aria-label={`${selectedSeries.map((series) => series.label).join(" and ")} by category for ${block.title}`}
    >
      {rows.map((row, rowIndex) => (
        <li key={`${String(row[xColumn] ?? "category")}-${rowIndex}`}>
          <strong className="context-mobile-bar-category">
            {formatContextChartCell(row[xColumn], categoryColumn)}
          </strong>
          <span className="context-mobile-bar-series">
            {selectedSeries.map((series, seriesIndex) => {
              const value = row[series.yColumn];
              const geometry = getRankedBarGeometry(values, value);
              const measureColumn = block.chart.columns.find(
                (column) => column.key === series.yColumn,
              );
              const unit = series.unit ?? measureColumn?.unit;
              return (
                <span
                  className="context-mobile-bar-measure"
                  key={series.id}
                  style={{
                    "--context-mobile-bar-color": CHART_COLORS[theme][seriesIndex % CHART_COLORS[theme].length],
                  } as CSSProperties}
                >
                  <span className="context-mobile-bar-value">
                    {showSeriesLabels ? <span>{series.label}</span> : null}
                    <strong>{formatContextChartCell(value, measureColumn)}</strong>
                    {unit && geometry ? <span> {unit}</span> : null}
                  </span>
                  <span className="context-mobile-bar-track" aria-hidden="true">
                    {geometry ? (
                      <>
                        <span
                          className="context-mobile-bar-zero-line"
                          style={{ left: `${geometry.zeroPercent}%` }}
                        />
                        {geometry.direction === "zero" ? (
                          <span
                            className="context-mobile-bar-zero-value"
                            style={{ left: `${geometry.zeroPercent}%` }}
                          />
                        ) : (
                          <span
                            className={`context-mobile-bar-fill context-mobile-bar-fill-${geometry.direction}`}
                            style={{
                              left: `${geometry.startPercent}%`,
                              width: `${geometry.widthPercent}%`,
                            }}
                          />
                        )}
                      </>
                    ) : null}
                  </span>
                </span>
              );
            })}
          </span>
        </li>
      ))}
    </ol>
  );
};

const ChartDataDisclosure = ({
  block,
  rowHeaderKey,
}: {
  block: ContextChartBlock;
  rowHeaderKey: string;
}) => (
  <StructuredDataDisclosure
    label="Exact chart data"
    title={block.title}
    meta={`${countLabel(block.chart.rows.length, "row")}, ${countLabel(block.chart.columns.length, "column")}`}
  >
    <div className="context-table-wrap" role="region" aria-labelledby={`${block.id}-table-caption`} tabIndex={0}>
      <table className="context-data-table">
        <caption id={`${block.id}-table-caption`}>Exact data for {block.title}</caption>
        <thead>
          <tr>
            {block.chart.columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}{column.unit ? <span> ({column.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.chart.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.chart.columns.map((column) => (
                column.key === rowHeaderKey ? (
                  <th key={column.key} scope="row">{formatContextChartCell(row[column.key], column)}</th>
                ) : (
                  <td key={column.key}>{formatContextChartCell(row[column.key], column)}</td>
                )
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </StructuredDataDisclosure>
);

const formatSeriesList = (labels: string[]): string => {
  if (labels.length <= 1) return labels[0] ?? "No metrics";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
};

const getSeriesUnit = (
  block: ContextChartBlock,
  series: ContextChartSeries,
): string | undefined =>
  series.unit ?? block.chart.columns.find(
    (column) => column.key === series.yColumn,
  )?.unit;

const formatSeriesLabel = (
  block: ContextChartBlock,
  series: ContextChartSeries,
): string => {
  const unit = getSeriesUnit(block, series);
  if (!unit) return series.label;
  const normalizedLabel = series.label.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const normalizedUnit = unit.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (
    normalizedLabel.endsWith(`(${normalizedUnit})`) ||
    (normalizedUnit === "%" && /(?:%|percent|percentage)(?:\W|$)/i.test(series.label))
  ) {
    return series.label;
  }
  return `${series.label} (${unit})`;
};

const RankingMetricPanel = ({
  block,
  presentation,
  series,
  color,
}: {
  block: ContextChartBlock;
  presentation: RankedChartPresentation;
  series: ContextChartSeries;
  color: string;
}) => {
  const measureColumn = block.chart.columns.find(
    (column) => column.key === series.yColumn,
  );
  const measureUnit = series.unit ?? measureColumn?.unit;
  const values = presentation.visibleRows.map((row) => row[series.yColumn]);
  const headingId = `${block.id}-${series.id}-ranking-heading`;

  return (
    <section
      className="context-ranking-panel"
      aria-labelledby={headingId}
      style={{ "--context-ranking-color": color } as CSSProperties}
    >
      <h4 id={headingId}>
        {series.label}
        {measureUnit ? <span> ({measureUnit})</span> : null}
      </h4>
      <ol
        className="context-ranked-bars"
        aria-label={`${series.label} for the first ${presentation.visibleRows.length} published entries in ${block.title}`}
      >
        {presentation.visibleRows.map((row, rowIndex) => {
          const value = row[series.yColumn];
          const geometry = getRankedBarGeometry(values, value);
          return (
            <li key={`${String(row[presentation.rankColumn.key] ?? rowIndex)}-${String(row[presentation.entityColumn.key])}`}>
              <span className="context-ranked-bar-identity">
                <span className="context-ranking-position">
                  <span className="sr-only">{presentation.rankColumn.label}: </span>
                  {formatContextChartCell(row[presentation.rankColumn.key])}
                </span>
                <span className="context-ranking-entry">
                  <strong>
                    <span className="sr-only">{presentation.entityColumn.label}: </span>
                    {formatContextChartCell(row[presentation.entityColumn.key])}
                  </strong>
                  {presentation.outcomeColumn && row[presentation.outcomeColumn.key] ? (
                    <span>
                      <span className="sr-only">{presentation.outcomeColumn.label}: </span>
                      {formatContextChartCell(row[presentation.outcomeColumn.key])}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="context-ranked-bar-measure">
                <span className="context-ranked-bar-track" aria-hidden="true">
                  {geometry ? (
                    <>
                      <span
                        className="context-ranked-bar-zero-line"
                        style={{ left: `${geometry.zeroPercent}%` }}
                      />
                      {geometry.direction === "zero" ? (
                        <span
                          className="context-ranked-bar-zero-value"
                          style={{ left: `${geometry.zeroPercent}%` }}
                        />
                      ) : (
                        <span
                          className={`context-ranked-bar-fill context-ranked-bar-fill-${geometry.direction}`}
                          style={{
                            left: `${geometry.startPercent}%`,
                            width: `${geometry.widthPercent}%`,
                          }}
                        />
                      )}
                    </>
                  ) : null}
                </span>
                <span className="context-ranking-measure">
                  <span className="sr-only">{series.label}: </span>
                  <strong>{formatContextChartCell(value)}</strong>
                  {measureUnit ? <span> {measureUnit}</span> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

const RankingOverview = ({
  block,
  presentation,
  caption,
  captionId,
}: {
  block: ContextChartBlock;
  presentation: RankedChartPresentation;
  caption: string;
  captionId: string;
}) => {
  const { theme } = useTheme();
  const [selectedIds, setSelectedIds] = useState(
    () => new Set([presentation.measureSeries.id]),
  );
  const selectedSeries = presentation.availableSeries.filter((series) =>
    selectedIds.has(series.id),
  );
  const controlHelpId = `${block.id}-ranking-metric-help`;
  const selectionLabels = selectedSeries.map((series) => series.label);
  const toggleSeries = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size === 1) return current;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="context-kind-view context-ranking-view">
      {presentation.availableSeries.length > 1 ? (
        <>
          <fieldset
            className="context-series-controls context-ranking-controls"
            aria-describedby={controlHelpId}
          >
            <legend>Metrics shown in the ranking overview</legend>
            {presentation.availableSeries.map((series) => {
              const checked = selectedIds.has(series.id);
              const unit = series.unit ?? block.chart.columns.find(
                (column) => column.key === series.yColumn,
              )?.unit;
              return (
                <label key={series.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && selectedIds.size === 1}
                    onChange={() => toggleSeries(series.id)}
                  />
                  <span>{series.label}{unit ? ` (${unit})` : ""}</span>
                </label>
              );
            })}
          </fieldset>
          <p id={controlHelpId} className="context-ranking-control-help">
            The primary metric is selected first. Add another metric to compare it on a separate scale; at least one metric remains shown.
          </p>
        </>
      ) : null}
      <p className="context-ranking-selection-status" role="status">
        {formatSeriesList(selectionLabels)} shown. Each metric uses its own scale with a visible zero baseline.
      </p>
      <figure className="context-visual context-ranking-overview">
        <div className="context-ranking-panels">
          {selectedSeries.map((series) => (
            <RankingMetricPanel
              key={series.id}
              block={block}
              presentation={presentation}
              series={series}
              color={CHART_COLORS[theme][
                presentation.availableSeries.indexOf(series) % CHART_COLORS[theme].length
              ]}
            />
          ))}
        </div>
        <p className="context-ranking-summary">
          {presentation.hiddenRowCount > 0
            ? `The overview pictures the first ${presentation.visibleRows.length} of ${presentation.rows.length} published entries in source ranking order. Expand Exact chart data for all ${presentation.rows.length}.`
            : `The overview pictures all ${presentation.rows.length} published entries in source ranking order.`}
        </p>
        <figcaption id={captionId} className="context-visual-caption">
          {caption} Bar lengths provide supporting metric context and do not determine the published rank.
        </figcaption>
      </figure>
      <ChartDataDisclosure
        block={block}
        rowHeaderKey={presentation.entityColumn.key}
      />
    </div>
  );
};

const OrdinalPositionOverview = ({
  block,
  presentation,
  caption,
  captionId,
}: {
  block: ContextChartBlock;
  presentation: OrdinalPositionPresentation;
  caption: string;
  captionId: string;
}) => {
  const headingId = `${block.id}-ordinal-position-heading`;
  const measureLabel = presentation.measureSeries.label;
  const omittedDetails = [
    presentation.truncatedRowCount > 0
      ? `${presentation.truncatedRowCount} more ${presentation.truncatedRowCount === 1 ? "row remains" : "rows remain"} in Exact chart data`
      : "",
    presentation.unusableRowCount > 0
      ? `${presentation.unusableRowCount} ${presentation.unusableRowCount === 1 ? "source row is" : "source rows are"} omitted because the category or ordinal position is unusable`
      : "",
  ].filter(Boolean);

  return (
    <div className="context-kind-view context-ordinal-position-view">
      <p className="context-ordinal-position-explanation">
        Lower numbers indicate a higher position; No. 1 is the highest.
      </p>
      <figure className="context-visual context-ordinal-position-overview">
        <section aria-labelledby={headingId}>
          <h4 id={headingId}>{measureLabel}</h4>
          <dl className="context-ordinal-position-list">
            {presentation.visibleRows.map((row, index) => {
              const category = formatContextChartCell(
                row[presentation.categoryColumn.key],
                presentation.categoryColumn,
              );
              const value = formatContextChartCell(
                row[presentation.measureColumn.key],
                presentation.measureColumn,
              );
              return (
                <div key={`${category}-${index}`}>
                  <dt>{category}</dt>
                  <dd>
                    <span className="sr-only">{measureLabel}: number </span>
                    <span aria-hidden="true">No. </span>
                    <strong>{value}</strong>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="context-ordinal-position-summary">
            Showing {presentation.visibleRows.length === presentation.rows.length
              ? `all ${presentation.rows.length}`
              : `the first ${presentation.visibleRows.length} of ${presentation.rows.length}`} usable positions in source order{omittedDetails.length > 0 ? `; ${omittedDetails.join("; ")}` : ""}.
          </p>
        </section>
        <figcaption id={captionId} className="context-visual-caption">
          {caption} Positions are ordinal results, so they are shown as exact numbers rather than proportional bars.
        </figcaption>
      </figure>
      <ChartDataDisclosure
        block={block}
        rowHeaderKey={presentation.categoryColumn.key}
      />
    </div>
  );
};

const StandardChartView = ({
  block,
  caption,
  captionId,
}: {
  block: ContextChartBlock;
  caption: string;
  captionId: string;
}) => {
  const presentation = useMemo(
    () => getStandardChartPresentation(block),
    [block],
  );
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(
      (presentation?.defaultSeries ?? block.chart.series.slice(0, 1)).map(
        (series) => series.id,
      ),
    ),
  );
  const selectedSeries = useMemo(
    () => (presentation?.availableSeries ?? block.chart.series).filter(
      (series) => selectedIds.has(series.id),
    ),
    [block.chart.series, presentation, selectedIds],
  );
  const selectedFamilyViews = useMemo(
    () => presentation?.families.flatMap((family) => {
      const familySeries = family.series.filter((series) => selectedIds.has(series.id));
      if (familySeries.length === 0) return [];
      const view = getStandardChartFamilyView(block, family, familySeries);
      return view ? [{ family, view }] : [];
    }) ?? [],
    [block, presentation, selectedIds],
  );
  const availableSeries = presentation?.availableSeries ?? block.chart.series;
  const controlHelpId = `${block.id}-standard-chart-help`;
  const toggleSeries = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size === 1) return current;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!presentation) {
    const fallbackSeries = selectedSeries.length > 0
      ? selectedSeries
      : block.chart.series.slice(0, 1);
    const fallbackRenderKind: Exclude<StandardChartRenderKind, "exact-only"> =
      fallbackSeries.every((series) => series.type === "pie")
        ? "pie"
        : fallbackSeries.every(
              (series) => series.type === "line" || series.type === "area",
            )
          ? "line"
          : "bar";
    return (
      <div className="context-kind-view">
        <figure className="context-visual context-chart-graphic">
          <EChartsGraphic
            block={block}
            rows={block.chart.rows}
            renderKind={fallbackRenderKind}
            selectedSeries={fallbackSeries}
            zeroBaseline={shouldStandardChartUseZeroBaseline(
              fallbackSeries,
              block.chart.rows,
            )}
          />
          <figcaption id={captionId} className="context-visual-caption">
            {caption}
          </figcaption>
        </figure>
        <ChartDataDisclosure
          block={block}
          rowHeaderKey={block.chart.series[0]?.xColumn ?? block.chart.columns[0].key}
        />
      </div>
    );
  }

  return (
    <div className="context-kind-view context-standard-chart-view">
      {availableSeries.length > 1 ? (
        <>
        <fieldset
          className="context-series-controls context-standard-chart-controls"
          aria-describedby={controlHelpId}
        >
          <legend>Series shown in the visual overview</legend>
          {availableSeries.map((series) => {
            const checked = selectedIds.has(series.id);
            return (
              <label key={series.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && selectedIds.size === 1}
                  onChange={() => toggleSeries(series.id)}
                />
                <span>{formatSeriesLabel(block, series)}</span>
              </label>
            );
          })}
        </fieldset>
        <p id={controlHelpId} className="context-standard-chart-control-help">
          {presentation.selectionSummary} Series with different units appear in separate panels; at least one series remains shown.
        </p>
        </>
      ) : null}
      <p className="context-standard-chart-selection-status" role="status">
        {formatSeriesList(selectedSeries.map((series) => series.label))} shown
        {selectedFamilyViews.length > 1
          ? ` across ${selectedFamilyViews.length} separate scales.`
          : " on one compatible scale."}
      </p>
      <figure className="context-visual context-chart-graphic context-standard-chart-overview">
        <div className="context-standard-chart-panels">
          {selectedFamilyViews.map(({ family, view }) => {
            const headingId = `${block.id}-${family.id}-chart-heading`;
            const heading = family.scaleKind === "unspecified"
              ? formatSeriesList(view.selectedSeries.map((candidate) => candidate.label))
              : family.label;
            return (
              <section
                key={family.id}
                className="context-standard-chart-panel"
                aria-labelledby={headingId}
              >
                <h4 id={headingId}>{heading}</h4>
                {view.renderKind === "exact-only" ? (
                  <p className="context-standard-chart-omission">
                    {view.rowSummary}
                  </p>
                ) : (
                  <>
                    <EChartsGraphic
                      block={block}
                      rows={view.visualRows}
                      renderKind={view.renderKind}
                      selectedSeries={view.selectedSeries}
                      zeroBaseline={view.zeroBaseline}
                    />
                    <p className="context-standard-chart-summary">
                      {view.rowSummary}
                    </p>
                  </>
                )}
              </section>
            );
          })}
        </div>
        {presentation.hiddenSeriesCount > 0 ? (
          <p className="context-standard-chart-summary">
            {presentation.hiddenSeriesCount} additional {presentation.hiddenSeriesCount === 1 ? "series remains" : "series remain"} available in Exact chart data.
          </p>
        ) : null}
        <figcaption id={captionId} className="context-visual-caption">
          {caption}
          {selectedFamilyViews.some(
            ({ view }) => view.hiddenRowCount > 0 || view.renderKind === "exact-only",
          )
            ? " This caption summarizes the complete source table; the overview subset is described above."
            : ""}
        </figcaption>
      </figure>
      <ChartDataDisclosure
        block={block}
        rowHeaderKey={presentation.categoryColumn.key}
      />
    </div>
  );
};

export const ContextChartView = ({
  block,
  caption,
  captionId,
}: {
  block: ContextChartBlock;
  caption: string;
  captionId: string;
}) => {
  const ranking = getRankedChartPresentation(block);
  const ordinalPosition = ranking ? null : getOrdinalPositionPresentation(block);
  return ranking ? (
    <RankingOverview
      block={block}
      presentation={ranking}
      caption={caption}
      captionId={captionId}
    />
  ) : ordinalPosition ? (
    <OrdinalPositionOverview
      block={block}
      presentation={ordinalPosition}
      caption={caption}
      captionId={captionId}
    />
  ) : (
    <StandardChartView
      block={block}
      caption={caption}
      captionId={captionId}
    />
  );
};

export const ContextDiagramView = ({
  block,
  caption,
  captionId,
  descriptionId,
}: {
  block: ContextDiagramBlock;
  caption: string;
  captionId: string;
  descriptionId: string;
}) => {
  const [zoom, setZoom] = useState(1);
  const image = block.diagram.image;
  return (
    <div className="context-kind-view">
      <figure className="context-diagram-figure">
        <div
          className="context-diagram-scroll"
          role="region"
          aria-label={`Scrollable diagram: ${block.title}`}
          tabIndex={0}
        >
          <Image
            src={image.src}
            alt={image.alt}
            aria-describedby={`${captionId} ${descriptionId}`}
            width={image.width ?? 1200}
            height={image.height ?? 800}
            unoptimized
            className="context-diagram-image"
            style={{ width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }}
          />
        </div>
        <figcaption id={captionId} className="context-visual-caption">
          {caption}
        </figcaption>
      </figure>
      <div className="context-diagram-controls" aria-label="Diagram zoom controls">
        <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} disabled={zoom >= 3}>
          Zoom in
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={zoom <= 1}>
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>
          Reset image
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)} percent</span>
      </div>

      {block.diagram.parts.length > 0 ? (
        <section aria-labelledby={`${block.id}-parts-heading`}>
          <h4 id={`${block.id}-parts-heading`}>Named parts</h4>
          <dl className="context-parts-list">
            {block.diagram.parts.map((part) => (
              <div key={part.id}>
                <dt>{part.label}</dt>
                <dd>{part.description ?? "No additional description provided."}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {block.diagram.relationships.length > 0 ? (
        <section aria-labelledby={`${block.id}-relationships-heading`}>
          <h4 id={`${block.id}-relationships-heading`}>Relationships</h4>
          <ul className="context-relationship-list">
            {block.diagram.relationships.map((relationship, index) => {
              const from = block.diagram.parts.find((part) => part.id === relationship.fromId)?.label ?? relationship.fromId;
              const to = block.diagram.parts.find((part) => part.id === relationship.toId)?.label ?? relationship.toId;
              return <li key={`${relationship.fromId}-${relationship.toId}-${index}`}><strong>{from}</strong> {relationship.label} <strong>{to}</strong>.</li>;
            })}
          </ul>
        </section>
      ) : null}

      {block.diagram.walkthrough.length > 0 ? (
        <section aria-labelledby={`${block.id}-walkthrough-heading`}>
          <h4 id={`${block.id}-walkthrough-heading`}>Walkthrough</h4>
          <ol className="context-walkthrough">
            {block.diagram.walkthrough.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
        </section>
      ) : null}
    </div>
  );
};
