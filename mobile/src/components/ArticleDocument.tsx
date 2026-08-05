import {
  articleRouteFromTitle,
  normalizeMediaWikiNumericId,
  type WikimediaMediaAttribution,
  type WikipediaArticle,
  type WikipediaSection,
} from "@curio-garden/domain";
import { useState, type ReactElement } from "react";
import { Image, StyleSheet, View } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import { GardenCard } from "./GardenCard";
import {
  GardenLink,
  normalizeSafeExternalUrl,
  type GardenLinkAttempt,
} from "./GardenLink";

export const ARTICLE_PARAGRAPH_CHUNK_LIMIT = 1_200;
export const DEFAULT_LEAD_IMAGE_ASPECT_RATIO = 16 / 9;
export const MIN_LEAD_IMAGE_ASPECT_RATIO = 3 / 4;
export const MAX_LEAD_IMAGE_ASPECT_RATIO = 2;

const CURIO_GARDEN_ORIGIN = "https://curiogarden.org";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const wikipediaLanguage = /^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/u;
const urlLikeAttribution = /^[a-z][a-z\d+.-]*:\/\//iu;
const combiningMark = /\p{M}/u;
const extendedPictographic = /\p{Extended_Pictographic}/u;
const ZERO_WIDTH_JOINER = 0x200d;

type LocatedCodePoint = Readonly<{ start: number; value: number }>;
type HangulSyllableType = "L" | "V" | "T" | "LV" | "LVT";

function codePointBefore(value: string, boundary: number): LocatedCodePoint {
  let start = boundary - 1;
  const trailingCodeUnit = value.charCodeAt(start);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && start > 0) {
    const leadingCodeUnit = value.charCodeAt(start - 1);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) start -= 1;
  }

  return { start, value: value.codePointAt(start) ?? 0 };
}

function isGraphemeExtender(codePoint: number): boolean {
  return (
    combiningMark.test(String.fromCodePoint(codePoint)) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint >= 0xe0020 && codePoint <= 0xe007f)
  );
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function resolveHangulSyllableType(
  codePoint: number,
): HangulSyllableType | null {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c)
  ) {
    return "L";
  }
  if (
    (codePoint >= 0x1160 && codePoint <= 0x11a7) ||
    (codePoint >= 0xd7b0 && codePoint <= 0xd7c6)
  ) {
    return "V";
  }
  if (
    (codePoint >= 0x11a8 && codePoint <= 0x11ff) ||
    (codePoint >= 0xd7cb && codePoint <= 0xd7fb)
  ) {
    return "T";
  }
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    return (codePoint - 0xac00) % 28 === 0 ? "LV" : "LVT";
  }
  return null;
}

function continuesHangulSyllable(previous: number, next: number): boolean {
  const previousType = resolveHangulSyllableType(previous);
  const nextType = resolveHangulSyllableType(next);

  return (
    (previousType === "L" &&
      (nextType === "L" ||
        nextType === "V" ||
        nextType === "LV" ||
        nextType === "LVT")) ||
    ((previousType === "LV" || previousType === "V") &&
      (nextType === "V" || nextType === "T")) ||
    ((previousType === "LVT" || previousType === "T") && nextType === "T")
  );
}

function isGraphemePrepend(codePoint: number): boolean {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    (codePoint >= 0x0890 && codePoint <= 0x0891) ||
    codePoint === 0x08e2 ||
    codePoint === 0x0d4e ||
    codePoint === 0x110bd ||
    codePoint === 0x110cd ||
    (codePoint >= 0x111c2 && codePoint <= 0x111c3) ||
    codePoint === 0x113d1 ||
    codePoint === 0x1193f ||
    codePoint === 0x11941 ||
    (codePoint >= 0x11a84 && codePoint <= 0x11a89) ||
    codePoint === 0x11d46 ||
    codePoint === 0x11f02
  );
}

function isExtendedPictographic(codePoint: number): boolean {
  return extendedPictographic.test(String.fromCodePoint(codePoint));
}

function extendsPictographicSequenceBeforeZwj(
  value: string,
  zwjStart: number,
): boolean {
  let cursor = zwjStart;
  while (cursor > 0) {
    const candidate = codePointBefore(value, cursor);
    if (isGraphemeExtender(candidate.value)) {
      cursor = candidate.start;
      continue;
    }
    return isExtendedPictographic(candidate.value);
  }
  return false;
}

function isSafeGraphemeBoundary(value: string, boundary: number): boolean {
  if (boundary <= 0 || boundary >= value.length) return true;

  const previousCodeUnit = value.charCodeAt(boundary - 1);
  const nextCodeUnit = value.charCodeAt(boundary);
  if (
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    return false;
  }

  const previous = codePointBefore(value, boundary);
  const next = value.codePointAt(boundary) ?? 0;
  const continuesEmojiZwjSequence =
    previous.value === ZERO_WIDTH_JOINER &&
    isExtendedPictographic(next) &&
    extendsPictographicSequenceBeforeZwj(value, previous.start);
  if (
    (previous.value === 0x0d && next === 0x0a) ||
    continuesHangulSyllable(previous.value, next) ||
    isGraphemePrepend(previous.value) ||
    continuesEmojiZwjSequence ||
    next === ZERO_WIDTH_JOINER ||
    isGraphemeExtender(next)
  ) {
    return false;
  }

  if (isRegionalIndicator(previous.value) && isRegionalIndicator(next)) {
    let precedingRegionalIndicators = 0;
    let cursor = boundary;
    while (cursor > 0) {
      const candidate = codePointBefore(value, cursor);
      if (!isRegionalIndicator(candidate.value)) break;
      precedingRegionalIndicators += 1;
      cursor = candidate.start;
    }
    return precedingRegionalIndicators % 2 === 0;
  }

  return true;
}

function resolveSafeChunkBoundary(
  value: string,
  start: number,
  preferredBoundary: number,
): number {
  let boundary = preferredBoundary;
  while (boundary > start && !isSafeGraphemeBoundary(value, boundary)) {
    boundary = codePointBefore(value, boundary).start;
  }
  if (boundary > start) return boundary;

  boundary = preferredBoundary;
  while (boundary < value.length && !isSafeGraphemeBoundary(value, boundary)) {
    const codePoint = value.codePointAt(boundary);
    boundary += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  }
  return boundary;
}

export interface ArticleDocumentProps {
  article: WikipediaArticle;
  onExternalLinkError: (attempt: GardenLinkAttempt) => void;
  onExternalLinkStart?: (attempt: GardenLinkAttempt) => void;
  openUrl?: (url: string) => Promise<unknown>;
}

/** Returns the canonical web destination without decoding and re-encoding it. */
export function buildCanonicalArticleUrl(title: string): string | null {
  try {
    const route = articleRouteFromTitle(title);
    return normalizeSafeExternalUrl(
      `${CURIO_GARDEN_ORIGIN}${route.canonicalPath}`,
    );
  } catch (error) {
    if (error instanceof RangeError || error instanceof URIError) return null;
    throw error;
  }
}

/** Builds a revision-pinned Wikipedia URL only from bounded, validated parts. */
export function buildWikipediaRevisionUrl(
  language: string,
  revisionId: string,
): string | null {
  const normalizedLanguage = language.normalize("NFC").trim().toLowerCase();
  const normalizedRevisionId = normalizeMediaWikiNumericId(revisionId);

  if (
    !wikipediaLanguage.test(normalizedLanguage) ||
    normalizedRevisionId === null
  ) {
    return null;
  }

  return normalizeSafeExternalUrl(
    `https://${normalizedLanguage}.wikipedia.org/w/index.php?oldid=${normalizedRevisionId}`,
  );
}

/**
 * Keeps corrupt dimensions from producing an unusably tall or wide lead image.
 * Valid extreme artwork remains visible inside a bounded, contain-fit frame.
 */
export function resolveLeadImageAspectRatio(
  width: number | undefined,
  height: number | undefined,
): number {
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return DEFAULT_LEAD_IMAGE_ASPECT_RATIO;
  }

  return Math.min(
    MAX_LEAD_IMAGE_ASPECT_RATIO,
    Math.max(MIN_LEAD_IMAGE_ASPECT_RATIO, width / height),
  );
}

export function normalizeLeadImageUrl(
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  return normalizeSafeExternalUrl(value);
}

/**
 * Splits prose into screen-reader-sized stops. Long paragraphs are sliced at a
 * nearby whitespace boundary when possible; after insignificant outer
 * whitespace is normalized, every character is retained, including whitespace
 * at a chunk boundary. `maxChunkLength` is a target rather than a hard cap: one
 * intact grapheme may exceed it when splitting that grapheme would corrupt text.
 */
export function splitArticleProse(
  content: string,
  maxChunkLength = ARTICLE_PARAGRAPH_CHUNK_LIMIT,
): readonly string[] {
  const trimmedContent = content.trim();
  if (!trimmedContent) return [];

  const chunkLimit =
    Number.isSafeInteger(maxChunkLength) && maxChunkLength > 0
      ? maxChunkLength
      : ARTICLE_PARAGRAPH_CHUNK_LIMIT;
  const paragraphs = trimmedContent
    .split(/(?:\r?\n[\t ]*){2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => {
    const chunks: string[] = [];
    let start = 0;

    while (paragraph.length - start > chunkLimit) {
      const windowEnd = start + chunkLimit;
      const earliestNaturalBreak = start + Math.floor(chunkLimit * 0.6);
      let end = windowEnd;

      for (
        let index = windowEnd - 1;
        index >= earliestNaturalBreak;
        index -= 1
      ) {
        if (/\s/u.test(paragraph[index] ?? "")) {
          end = index + 1;
          break;
        }
      }

      end = resolveSafeChunkBoundary(paragraph, start, end);

      chunks.push(paragraph.slice(start, end));
      start = end;
    }

    if (start < paragraph.length) chunks.push(paragraph.slice(start));
    return chunks;
  });
}

type ResolvedSection = Readonly<{
  section: WikipediaSection;
  title: string;
  paragraphs: readonly string[];
}>;

function resolveSections(
  sections: readonly WikipediaSection[] | undefined,
): readonly ResolvedSection[] {
  const candidates = (sections ?? []).map((section, index) => ({
    hasSourceTitle: Boolean(section.title.trim()),
    paragraphs: splitArticleProse(section.content),
    section,
    title: section.title.trim() || `Section ${index + 1}`,
  }));

  return candidates.flatMap((candidate, index) => {
    if (candidate.paragraphs.length > 0) return [candidate];
    if (!candidate.hasSourceTitle) return [];

    let introducesReadableDescendant = false;
    for (
      let nextIndex = index + 1;
      nextIndex < candidates.length;
      nextIndex += 1
    ) {
      const descendant = candidates[nextIndex];
      if (!descendant || descendant.section.level <= candidate.section.level) {
        break;
      }
      if (descendant.paragraphs.length > 0) {
        introducesReadableDescendant = true;
        break;
      }
    }

    return introducesReadableDescendant ? [candidate] : [];
  });
}

function normalizeAttributionText(value: string | undefined): string | null {
  const normalized = value?.normalize("NFC").trim();
  if (!normalized || urlLikeAttribution.test(normalized)) return null;
  return normalized;
}

interface ImageAttributionProps {
  attribution: WikimediaMediaAttribution | undefined;
  onExternalLinkError: (attempt: GardenLinkAttempt) => void;
  onExternalLinkStart: ((attempt: GardenLinkAttempt) => void) | undefined;
  openUrl: ((url: string) => Promise<unknown>) | undefined;
}

function ImageAttribution({
  attribution,
  onExternalLinkError,
  onExternalLinkStart,
  openUrl,
}: ImageAttributionProps): ReactElement {
  const { spacing } = useGardenTheme();
  const creator = normalizeAttributionText(attribution?.creator);
  const credit = normalizeAttributionText(attribution?.credit);
  const licenseName = normalizeAttributionText(attribution?.licenseName);
  const sourceTitle = normalizeAttributionText(attribution?.sourceTitle);
  const licenseUrl = attribution?.licenseUrl
    ? normalizeSafeExternalUrl(attribution.licenseUrl)
    : null;
  const sourceUrl = attribution?.sourceUrl
    ? normalizeSafeExternalUrl(attribution.sourceUrl)
    : null;
  const hasAttribution = Boolean(
    creator || credit || licenseName || licenseUrl || sourceTitle || sourceUrl,
  );

  return (
    <View
      accessible={false}
      style={{ gap: spacing.xs }}
      testID="article-lead-image-attribution"
    >
      <GardenText color="foreground2" variant="eyebrow">
        Lead image credit
      </GardenText>
      {!hasAttribution ? (
        <GardenText color="muted" variant="metadata">
          No image credit was included with this source revision.
        </GardenText>
      ) : null}
      {creator ? (
        <GardenText color="muted" variant="metadata">
          Creator: {creator}
        </GardenText>
      ) : null}
      {credit && credit !== creator ? (
        <GardenText color="muted" variant="metadata">
          Credit: {credit}
        </GardenText>
      ) : null}
      {licenseUrl ? (
        <GardenLink
          hint="Opens the lead image license in your browser."
          label={`Image license: ${licenseName ?? "View license terms"}`}
          onOpenError={onExternalLinkError}
          onOpenStart={onExternalLinkStart}
          openUrl={openUrl}
          url={licenseUrl}
        />
      ) : licenseName ? (
        <GardenText color="muted" variant="metadata">
          Image license: {licenseName}
        </GardenText>
      ) : null}
      {sourceUrl ? (
        <GardenLink
          hint="Opens the original lead image source in your browser."
          label={`Image source: ${sourceTitle ?? "Wikimedia file page"}`}
          onOpenError={onExternalLinkError}
          onOpenStart={onExternalLinkStart}
          openUrl={openUrl}
          url={sourceUrl}
        />
      ) : sourceTitle ? (
        <GardenText color="muted" variant="metadata">
          Image source: {sourceTitle} — link unavailable
        </GardenText>
      ) : null}
    </View>
  );
}

export function ArticleDocument({
  article,
  onExternalLinkError,
  onExternalLinkStart,
  openUrl,
}: ArticleDocumentProps): ReactElement {
  const { colors, radii, spacing } = useGardenTheme();
  const canonicalArticleUrl = buildCanonicalArticleUrl(article.title) ?? "";
  const wikipediaRevisionUrl =
    buildWikipediaRevisionUrl(article.language, article.revisionId) ?? "";
  const leadImageUrl = normalizeLeadImageUrl(article.thumbnailUrl);
  const requestedLeadImage = Boolean(article.thumbnailUrl?.trim());
  const hasLeadImageAttribution = Object.values(
    article.thumbnailAttribution ?? {},
  ).some((value) => Boolean(value?.trim()));
  const [failedLeadImageUrl, setFailedLeadImageUrl] = useState<string | null>(
    null,
  );
  const leadImageFailed =
    requestedLeadImage &&
    (leadImageUrl === null || failedLeadImageUrl === leadImageUrl);
  const summaryParagraphs = splitArticleProse(article.summary ?? "");
  const sections = resolveSections(article.sections);
  const readableSectionCount = sections.filter(
    (section) => section.paragraphs.length > 0,
  ).length;
  const normalizedLanguage = article.language.normalize("NFC").trim();
  const normalizedRevisionId = normalizeMediaWikiNumericId(article.revisionId);

  return (
    <View
      accessible={false}
      style={[styles.document, { gap: spacing.xxl }]}
      testID="article-document"
    >
      <View accessible={false} style={{ gap: spacing.xs }}>
        <GardenText color="accent" variant="eyebrow">
          Wikipedia source
        </GardenText>
        <GardenText color="muted" variant="metadata">
          {normalizedLanguage
            ? `Wikipedia (${normalizedLanguage.toLocaleUpperCase("en-US")})`
            : "Wikipedia"}
          {normalizedRevisionId ? ` · Revision ${normalizedRevisionId}` : ""}
        </GardenText>
      </View>

      {leadImageUrl && !leadImageFailed ? (
        <Image
          accessibilityLabel={`Lead image for ${article.title}`}
          accessibilityRole="image"
          accessible
          onError={() => setFailedLeadImageUrl(leadImageUrl)}
          resizeMode="contain"
          source={{ uri: leadImageUrl }}
          style={[
            styles.leadImage,
            {
              aspectRatio: resolveLeadImageAspectRatio(
                article.thumbnailWidth,
                article.thumbnailHeight,
              ),
              backgroundColor: colors.surface3,
              borderColor: colors.border,
              borderRadius: radii.xl,
            },
          ]}
          testID="article-lead-image"
        />
      ) : (
        <View
          accessible={false}
          style={[
            styles.imageFallback,
            {
              backgroundColor: colors.surface2,
              borderColor: colors.border,
              borderRadius: radii.xl,
              padding: spacing.xxl,
            },
          ]}
          testID="article-lead-image-unavailable"
        >
          <GardenText color="muted">
            {requestedLeadImage
              ? "Lead image unavailable."
              : "No lead image is available for this revision."}
          </GardenText>
        </View>
      )}

      {requestedLeadImage || hasLeadImageAttribution ? (
        <ImageAttribution
          attribution={article.thumbnailAttribution}
          onExternalLinkError={onExternalLinkError}
          onExternalLinkStart={onExternalLinkStart}
          openUrl={openUrl}
        />
      ) : null}

      <View accessible={false} style={{ gap: spacing.md }}>
        {summaryParagraphs.length > 0 ? (
          summaryParagraphs.map((paragraph, index) => (
            <GardenText
              color="foreground2"
              key={`summary-${index}`}
              testID={`article-summary-paragraph-${index}`}
              variant="intro"
            >
              {paragraph}
            </GardenText>
          ))
        ) : (
          <GardenText color="foreground2" variant="intro">
            {readableSectionCount > 0
              ? "No summary is available for this revision. Continue with the article sections below."
              : "No summary is available for this revision."}
          </GardenText>
        )}
      </View>

      <View accessible={false} style={{ gap: spacing.sm }}>
        <GardenText accessibilityRole="header" variant="sectionTitle">
          Explore this article
        </GardenText>
        <GardenText color="muted" variant="metadata">
          {readableSectionCount === 1
            ? "1 readable section follows."
            : `${readableSectionCount} readable sections follow.`}
        </GardenText>
      </View>

      {sections.length > 0 ? (
        sections.map(({ paragraphs, section, title }, sectionIndex) => (
          <View
            accessible={false}
            key={`${section.wikiSectionIndex}-${sectionIndex}`}
            style={{ gap: spacing.md }}
            testID={`article-section-${sectionIndex}`}
          >
            <GardenText accessibilityRole="header" variant="cardTitle">
              {title}
            </GardenText>
            {paragraphs.map((paragraph, paragraphIndex) => (
              <GardenText
                key={`${sectionIndex}-${paragraphIndex}`}
                testID={`article-section-${sectionIndex}-paragraph-${paragraphIndex}`}
              >
                {paragraph}
              </GardenText>
            ))}
          </View>
        ))
      ) : (
        <GardenText color="muted">
          No article sections are available for this revision.
        </GardenText>
      )}

      <GardenCard testID="article-source-and-license">
        <GardenText accessibilityRole="header" variant="sectionTitle">
          Source and license
        </GardenText>
        <GardenText color="foreground2">
          This article is based on the Wikipedia revision linked below.
        </GardenText>
        <GardenLink
          hint="Opens the exact source revision on Wikipedia in your browser."
          label={`View Wikipedia revision ${normalizedRevisionId ?? article.revisionId}`}
          onOpenError={onExternalLinkError}
          onOpenStart={onExternalLinkStart}
          openUrl={openUrl}
          testID="article-wikipedia-revision-link"
          url={wikipediaRevisionUrl}
        />
        <GardenText color="foreground2" variant="metadata">
          Wikipedia article content is available under the Creative Commons
          Attribution-ShareAlike 4.0 License.
        </GardenText>
        <GardenLink
          hint="Opens the article content license in your browser."
          label="Read the Creative Commons Attribution-ShareAlike 4.0 License"
          onOpenError={onExternalLinkError}
          onOpenStart={onExternalLinkStart}
          openUrl={openUrl}
          testID="article-license-link"
          url={CC_BY_SA_URL}
        />
      </GardenCard>

      <GardenCard testID="article-richer-web">
        <GardenText accessibilityRole="header" variant="sectionTitle">
          More on Curio Garden web
        </GardenText>
        <GardenText color="foreground2">
          Galleries, broader context, and citation details remain available on
          the canonical Curio Garden web article.
        </GardenText>
        <GardenLink
          hint="Opens this article on Curio Garden web in your browser."
          label="Open richer article features on Curio Garden web"
          onOpenError={onExternalLinkError}
          onOpenStart={onExternalLinkStart}
          openUrl={openUrl}
          testID="article-canonical-web-link"
          url={canonicalArticleUrl}
        />
      </GardenCard>
    </View>
  );
}

const styles = StyleSheet.create({
  document: {
    alignSelf: "stretch",
  },
  imageFallback: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 120,
  },
  leadImage: {
    alignSelf: "stretch",
    borderWidth: 1,
    width: "100%",
  },
});
