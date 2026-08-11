import type { WikipediaSection } from "@curio-garden/domain";

import type { NativeArticleAudioSectionKey } from "./NativeArticleAudioAccessContext";

export type NativeArticleAudioItemKind =
  | "summary"
  | "section"
  | "transition"
  | "unavailable";

export type NativeArticleAudioItem = Readonly<{
  includedInPlayAll: boolean;
  individuallyPlayable: boolean;
  kind: NativeArticleAudioItemKind;
  sectionIndex: number | null;
  sectionKey: NativeArticleAudioSectionKey;
  title: string;
}>;

export type NativeArticleAudioPlanSource = Readonly<{
  sections?: readonly WikipediaSection[];
  summary?: string;
}>;

/**
 * Reproduces the server's plaintext narration-track classification without
 * importing web implementation. Source-array indexes deliberately remain in
 * section keys even when an adjacent heading has no audio.
 */
export function buildNativeArticleAudioItems({
  sections = [],
  summary,
}: NativeArticleAudioPlanSource): readonly NativeArticleAudioItem[] {
  const items: NativeArticleAudioItem[] = [];

  if (summary?.trim()) {
    items.push({
      includedInPlayAll: true,
      individuallyPlayable: true,
      kind: "summary",
      sectionIndex: null,
      sectionKey: "summary",
      title: "Summary",
    });
  }

  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index];
    if (current === undefined) continue;
    const next = sections[index + 1];
    const hasContent = Boolean(current.content.trim());
    const isTransition =
      !hasContent && next !== undefined && next.level > current.level;
    const kind: NativeArticleAudioItemKind = hasContent
      ? "section"
      : isTransition
        ? "transition"
        : "unavailable";

    items.push({
      includedInPlayAll: kind !== "unavailable",
      individuallyPlayable: kind === "section",
      kind,
      sectionIndex: index,
      sectionKey: `section-${index}`,
      title: current.title.trim() || `Section ${index + 1}`,
    });
  }

  return items;
}
