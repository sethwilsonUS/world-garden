import type { ContextDiagramLegend } from "./article-context-types";
import { normalizeSafeCssColor } from "./safe-css-color";

export const MAX_CONTEXT_LEGEND_ENTRIES = 32;
export const MAX_CONTEXT_LEGEND_COLOR_LENGTH = 128;
export const MAX_CONTEXT_LEGEND_DESCRIPTION_TEXT_LENGTH = 800;
export const MAX_CONTEXT_LEGEND_ENTRY_TEXT_LENGTH = 500;
export const MAX_CONTEXT_LEGEND_NOTES = 8;
export const MAX_CONTEXT_LEGEND_NOTE_TEXT_LENGTH = 2_000;
export const MAX_CONTEXT_LEGEND_TOTAL_TEXT_LENGTH = 12_000;

/**
 * Mirrors the intentionally narrow color grammar accepted by semantic figure
 * ingestion. Legend colors are data, never arbitrary CSS declarations.
 */
export const isSafeContextLegendColor = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTEXT_LEGEND_COLOR_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }
  return (
    normalizeSafeCssColor(value, {
      maxLength: MAX_CONTEXT_LEGEND_COLOR_LENGTH,
    }) === value
  );
};

const isBoundedText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  value === value.trim() &&
  !/[<>]/u.test(value) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

const isBoundedDescription = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_CONTEXT_LEGEND_DESCRIPTION_TEXT_LENGTH &&
  value === value.trim() &&
  !/[<>]/u.test(value) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

export const isValidContextDiagramLegend = (
  value: unknown,
): value is ContextDiagramLegend => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const legend = value as Record<string, unknown>;
  if (
    !isBoundedDescription(legend.description) ||
    !Array.isArray(legend.entries) ||
    legend.entries.length === 0 ||
    legend.entries.length > MAX_CONTEXT_LEGEND_ENTRIES ||
    !Array.isArray(legend.notes) ||
    legend.notes.length > MAX_CONTEXT_LEGEND_NOTES
  ) {
    return false;
  }

  let totalTextLength = legend.description.length;
  for (const entry of legend.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      !isSafeContextLegendColor(candidate.color) ||
      !isBoundedText(candidate.text, MAX_CONTEXT_LEGEND_ENTRY_TEXT_LENGTH)
    ) {
      return false;
    }
    totalTextLength += candidate.text.length;
  }
  for (const note of legend.notes) {
    if (!isBoundedText(note, MAX_CONTEXT_LEGEND_NOTE_TEXT_LENGTH)) {
      return false;
    }
    totalTextLength += note.length;
  }
  return totalTextLength <= MAX_CONTEXT_LEGEND_TOTAL_TEXT_LENGTH;
};
