import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { Id } from "@/convex/_generated/dataModel";
import { addMp3MetadataToBlob } from "@/lib/audio-metadata";
import {
  fetchWikipediaFeaturedSnapshot,
  getWikipediaFeaturedFeedDate,
  type WikipediaDidYouKnowItem,
} from "@/lib/featured-article";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { generateTtsAudio } from "@/lib/tts-client";

const DID_YOU_KNOW_ALBUM = "Curio Garden Daily Curiosities";
const TTS_WORDS_PER_SECOND = 2.5;
const JOB_LEASE_MS = 8 * 60 * 1000;
const FEED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const inFlightDidYouKnowAudio = new Map<
  string,
  Promise<DidYouKnowAudioSyncResult>
>();

export type DidYouKnowAudioRecord = {
  _id: string;
  feedDate: string;
  status: "pending" | "ready" | "failed";
  title?: string;
  spokenText?: string;
  itemTexts?: string[];
  storageId?: string;
  durationSeconds?: number;
  byteLength?: number;
  voiceId?: string;
  lastError?: string;
  audioUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DidYouKnowAudioState = {
  feedDate: string;
  title: string;
  status: "missing" | "pending" | "ready" | "failed";
  audioUrl: string | null;
  durationSeconds?: number;
  lastError?: string;
  audio: DidYouKnowAudioRecord | null;
};

export type DidYouKnowAudioSyncResult = {
  status: "created" | "already_exists" | "pending";
  audio: DidYouKnowAudioRecord | null;
  feedDate: string;
  title: string;
};

const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<Id<"_storage">> => {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/mpeg" },
    body: blob,
  });

  if (!result.ok) {
    throw new Error(`Convex storage upload failed: ${result.status}`);
  }

  const body = (await result.json()) as { storageId?: Id<"_storage"> };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const estimateDurationSeconds = (text: string): number =>
  Math.max(
    1,
    Math.round(text.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND),
  );

const formatDidYouKnowDate = (feedDateIso: string): string => {
  try {
    const date = new Date(`${feedDateIso}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return feedDateIso;
    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return feedDateIso;
  }
};

const normalizeFactForSpeech = (text: string): string => {
  const cleaned = text.replace(/^\.\.\.\s*/, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const getSnapshotDate = (feedDateIso: string): Date =>
  new Date(`${feedDateIso}T12:00:00Z`);

export const buildDidYouKnowAudioTitle = (feedDateIso: string): string =>
  `Did You Know? ${formatDidYouKnowDate(feedDateIso)}`;

export const resolveDidYouKnowFeedDateIso = (feedDateIso?: string): string =>
  feedDateIso && FEED_DATE_RE.test(feedDateIso)
    ? feedDateIso
    : getWikipediaFeaturedFeedDate(0).replace(/\//g, "-");

export const buildDidYouKnowSpeechScript = ({
  feedDateIso,
  items,
}: {
  feedDateIso: string;
  items: WikipediaDidYouKnowItem[];
}): string => {
  const titleDate = formatDidYouKnowDate(feedDateIso);
  const facts = items
    .map((item) => normalizeFactForSpeech(item.text))
    .filter(Boolean)
    .map((itemText, index) => `Fact ${index + 1}. ${itemText}`);

  return [
    `Curio Garden. Did you know? ${titleDate}.`,
    ...facts,
    "End of today's Did you know list.",
  ].join("\n\n");
};

export const shouldReuseExistingDidYouKnowAudio = (
  record: DidYouKnowAudioRecord | null,
): record is DidYouKnowAudioRecord =>
  Boolean(record?.status === "ready" && record.audioUrl);

export const getDidYouKnowAudioState = async ({
  feedDateIso,
}: {
  feedDateIso?: string;
} = {}): Promise<DidYouKnowAudioState> => {
  const resolvedFeedDate = resolveDidYouKnowFeedDateIso(feedDateIso);
  const title = buildDidYouKnowAudioTitle(resolvedFeedDate);
  const record = (await fetchQuery(anyApi.didYouKnow.getDidYouKnowAudioByDate, {
    feedDate: resolvedFeedDate,
  })) as DidYouKnowAudioRecord | null;

  if (!record) {
    return {
      feedDate: resolvedFeedDate,
      title,
      status: "missing",
      audioUrl: null,
      audio: null,
    };
  }

  const status =
    record.status === "ready"
      ? record.audioUrl
        ? "ready"
        : "failed"
      : record.status;

  return {
    feedDate: resolvedFeedDate,
    title: record.title || title,
    status,
    audioUrl: record.audioUrl,
    durationSeconds: record.durationSeconds,
    lastError: record.lastError,
    audio: record,
  };
};

const generateDidYouKnowAudioRecord = async ({
  baseUrl,
  feedDateIso,
}: {
  baseUrl: string;
  feedDateIso?: string;
}): Promise<DidYouKnowAudioSyncResult> => {
  const resolvedFeedDate = resolveDidYouKnowFeedDateIso(feedDateIso);
  const title = buildDidYouKnowAudioTitle(resolvedFeedDate);
  const voiceId = process.env.DID_YOU_KNOW_VOICE_ID?.trim() || undefined;
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  let stage = "initializing";
  let spokenText: string | undefined;
  let itemTexts: string[] | undefined;

  const existing = (await fetchQuery(anyApi.didYouKnow.getDidYouKnowAudioByDate, {
    feedDate: resolvedFeedDate,
  })) as DidYouKnowAudioRecord | null;

  if (shouldReuseExistingDidYouKnowAudio(existing)) {
    return {
      status: "already_exists",
      audio: existing,
      feedDate: resolvedFeedDate,
      title: existing.title || title,
    };
  }

  const claim = await fetchMutation(anyApi.didYouKnow.claimDidYouKnowAudioJob, {
    feedDate: resolvedFeedDate,
    owner,
    leaseMs: JOB_LEASE_MS,
  });

  if (!claim.claimed) {
    const latest = (await fetchQuery(anyApi.didYouKnow.getDidYouKnowAudioByDate, {
      feedDate: resolvedFeedDate,
    })) as DidYouKnowAudioRecord | null;

    if (shouldReuseExistingDidYouKnowAudio(latest)) {
      return {
        status: "already_exists",
        audio: latest,
        feedDate: resolvedFeedDate,
        title: latest.title || title,
      };
    }

    return {
      status: "pending",
      audio: latest,
      feedDate: resolvedFeedDate,
      title,
    };
  }

  try {
    stage = "fetching_source";
    const snapshot = await fetchWikipediaFeaturedSnapshot(
      getSnapshotDate(resolvedFeedDate),
    );
    itemTexts = snapshot.didYouKnow.map((item) => item.text).filter(Boolean);

    if (snapshot.didYouKnow.length === 0) {
      throw new Error("Wikipedia did not return any Did You Know items");
    }

    spokenText = buildDidYouKnowSpeechScript({
      feedDateIso: resolvedFeedDate,
      items: snapshot.didYouKnow,
    });

    stage = "saving_pending";
    await fetchMutation(anyApi.didYouKnow.saveDidYouKnowAudio, {
      feedDate: resolvedFeedDate,
      status: "pending",
      title,
      spokenText,
      itemTexts,
      voiceId,
    });

    console.info(
      `[did-you-know ${resolvedFeedDate} run=${runId}] generating ${snapshot.didYouKnow.length} facts`,
    );

    stage = "generating_tts_audio";
    const sourceAudioBlob = await generateTtsAudio(
      { text: spokenText, voiceId },
      { apiBaseUrl: baseUrl },
    );

    stage = "tagging_audio";
    const taggedAudioBlob = await addMp3MetadataToBlob(sourceAudioBlob, {
      title,
      artist: "Curio Garden",
      album: DID_YOU_KNOW_ALBUM,
    });

    stage = "requesting_upload_url";
    const uploadUrl = await fetchMutation(anyApi.didYouKnow.generateUploadUrl, {});

    stage = "uploading_audio";
    const storageId = await uploadBlobToConvexStorage(uploadUrl, taggedAudioBlob);

    stage = "saving_ready";
    await fetchMutation(anyApi.didYouKnow.saveDidYouKnowAudio, {
      feedDate: resolvedFeedDate,
      status: "ready",
      title,
      spokenText,
      itemTexts,
      storageId,
      durationSeconds: estimateDurationSeconds(spokenText),
      byteLength: taggedAudioBlob.size,
      voiceId,
    });

    stage = "reloading_saved_audio";
    const saved = (await fetchQuery(anyApi.didYouKnow.getDidYouKnowAudioByDate, {
      feedDate: resolvedFeedDate,
    })) as DidYouKnowAudioRecord | null;

    if (!saved || saved.status !== "ready" || !saved.audioUrl) {
      throw new Error("Did You Know audio was saved but could not be reloaded");
    }

    stage = "finalizing_job";
    await fetchMutation(anyApi.didYouKnow.finalizeDidYouKnowAudioJob, {
      feedDate: resolvedFeedDate,
      owner,
      status: "ready",
    });

    console.info(
      `[did-you-know ${resolvedFeedDate} run=${runId}] success bytes=${taggedAudioBlob.size}`,
    );

    return {
      status: "created",
      audio: saved,
      feedDate: resolvedFeedDate,
      title: saved.title || title,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const detailedMessage = `[${stage}] ${message}`;

    console.error(
      `[did-you-know ${resolvedFeedDate} run=${runId}] failed at stage=${stage}: ${message}`,
      error,
    );

    await fetchMutation(anyApi.didYouKnow.finalizeDidYouKnowAudioJob, {
      feedDate: resolvedFeedDate,
      owner,
      status: "failed",
      lastError: detailedMessage,
    });

    await fetchMutation(anyApi.didYouKnow.saveDidYouKnowAudio, {
      feedDate: resolvedFeedDate,
      status: "failed",
      title,
      spokenText,
      itemTexts,
      voiceId,
      lastError: detailedMessage,
    });

    throw new Error(detailedMessage);
  }
};

export const syncDidYouKnowAudio = async ({
  baseUrl,
  feedDateIso,
}: {
  baseUrl: string;
  feedDateIso?: string;
}): Promise<DidYouKnowAudioSyncResult> => {
  const resolvedFeedDate = resolveDidYouKnowFeedDateIso(feedDateIso);
  const existing = (await fetchQuery(anyApi.didYouKnow.getDidYouKnowAudioByDate, {
    feedDate: resolvedFeedDate,
  })) as DidYouKnowAudioRecord | null;

  if (shouldReuseExistingDidYouKnowAudio(existing)) {
    return {
      status: "already_exists",
      audio: existing,
      feedDate: resolvedFeedDate,
      title: existing.title || buildDidYouKnowAudioTitle(resolvedFeedDate),
    };
  }

  const inFlight = inFlightDidYouKnowAudio.get(resolvedFeedDate);
  if (inFlight) {
    return inFlight;
  }

  const generationPromise = generateDidYouKnowAudioRecord({
    baseUrl: getPodcastSiteUrl(baseUrl),
    feedDateIso: resolvedFeedDate,
  }).finally(() => {
    inFlightDidYouKnowAudio.delete(resolvedFeedDate);
  });

  inFlightDidYouKnowAudio.set(resolvedFeedDate, generationPromise);
  return generationPromise;
};
