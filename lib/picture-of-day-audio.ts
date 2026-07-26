import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { Id } from "@/convex/_generated/dataModel";
import { addMp3MetadataToBlob } from "@/lib/audio-metadata";
import {
  getWikipediaFeaturedFeedDate,
  type WikipediaPictureOfDay,
} from "@/lib/featured-article";
import { getTodayWikipediaData } from "@/lib/today-snapshot";
import { generateTtsAudioWithMetadata } from "@/lib/tts-client";
import { getEdgeTtsGenerationHeaders } from "@/lib/tts-quota-bypass";
import { uploadBlobToConvexStorage } from "@/convex/lib/storageUpload";
import {
  createPublicAudioWriteAttestation,
  type PublicAudioWriteOperation,
} from "@/lib/public-audio-write-attestation";
import { isExactCurrentEdgeAudioMetadata } from "@/lib/public-edge-audio-metadata";

const PICTURE_OF_DAY_ALBUM = "Curio Garden Picture of the Day";
const TTS_WORDS_PER_SECOND = 2.5;
const JOB_LEASE_MS = 8 * 60 * 1000;
const FEED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION = 1;

const inFlightPictureAudio = new Map<
  string,
  Promise<PictureOfDayAudioSyncResult>
>();

const withPictureOfDayWriteAttestation = async <
  TArgs extends Record<string, unknown>,
>(
  operation: PublicAudioWriteOperation,
  args: TArgs,
) => ({
  ...args,
  attestation: await createPublicAudioWriteAttestation({
    pipeline: "picture-of-day",
    operation,
    args,
  }),
});

export type PictureOfDayAudioRecord = {
  _id: string;
  feedDate: string;
  pictureKey: string;
  scriptVersion: number;
  status: "pending" | "ready" | "failed";
  title?: string;
  spokenText?: string;
  storageId?: string;
  durationSeconds?: number;
  byteLength?: number;
  voiceId?: string;
  ttsCacheKey?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  lastError?: string;
  audioUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PictureOfDayAudioSyncResult = {
  status: "created" | "already_exists" | "pending" | "missing_source";
  audio: PictureOfDayAudioRecord | null;
  feedDate: string;
  title: string;
};

const formatPictureDate = (feedDateIso: string): string => {
  try {
    const date = new Date(`${feedDateIso}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return feedDateIso;
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return feedDateIso;
  }
};

const estimateDurationSeconds = (text: string): number =>
  Math.max(
    1,
    Math.round(text.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND),
  );

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const getStorageKey = ({
  feedDate,
  pictureKey,
  scriptVersion,
}: {
  feedDate: string;
  pictureKey: string;
  scriptVersion: number;
}): string => `${feedDate}|${pictureKey}|${scriptVersion}`;

export const resolvePictureOfDayFeedDateIso = (feedDateIso?: string): string =>
  feedDateIso && FEED_DATE_RE.test(feedDateIso)
    ? feedDateIso
    : getWikipediaFeaturedFeedDate(0).replace(/\//g, "-");

export const buildPictureOfDayAudioTitle = (feedDateIso: string): string =>
  `Picture of the Day: ${formatPictureDate(feedDateIso)}`;

export const buildPictureOfDaySpeechScript = ({
  feedDateIso,
  picture,
}: {
  feedDateIso: string;
  picture: WikipediaPictureOfDay;
}): string => {
  const lines = [
    `Curio Garden. Picture of the Day for ${formatPictureDate(feedDateIso)}.`,
  ];

  const description = picture.description.trim();
  if (description) {
    lines.push(description.endsWith(".") ? description : `${description}.`);
  } else {
    lines.push(`The picture is titled ${picture.title}.`);
  }

  if (picture.artist?.trim()) {
    lines.push(`Artist: ${picture.artist.trim()}.`);
  }

  if (picture.credit?.trim()) {
    lines.push(`Credit: ${picture.credit.trim()}.`);
  }

  lines.push(`Source file: ${picture.title} on Wikimedia Commons.`);

  if (picture.license?.type?.trim()) {
    lines.push(`License: ${picture.license.type.trim()}.`);
  }

  if (
    !picture.artist?.trim() &&
    !picture.credit?.trim() &&
    !picture.license?.type?.trim()
  ) {
    lines.push(
      "Creator and license details were not included in the feed metadata.",
    );
  }

  return lines.join("\n\n");
};

const shouldReuseExistingPictureAudio = (
  record: PictureOfDayAudioRecord | null,
): record is PictureOfDayAudioRecord =>
  Boolean(
    record?.status === "ready" &&
    record.audioUrl &&
    isExactCurrentEdgeAudioMetadata(record),
  );

const getPictureOfDayAudio = async ({
  feedDate,
  pictureKey,
}: {
  feedDate: string;
  pictureKey: string;
}): Promise<PictureOfDayAudioRecord | null> =>
  (await fetchQuery(anyApi.pictureOfDay.getPictureOfDayAudio, {
    feedDate,
    pictureKey,
    scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
  })) as PictureOfDayAudioRecord | null;

const generatePictureOfDayAudioRecord = async ({
  baseUrl,
  feedDateIso,
  picture,
}: {
  baseUrl: string;
  feedDateIso: string;
  picture: WikipediaPictureOfDay;
}): Promise<PictureOfDayAudioSyncResult> => {
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  let stage = "initializing";
  let spokenText: string | undefined;
  let committedReady = false;
  const title = buildPictureOfDayAudioTitle(feedDateIso);

  const existing = await getPictureOfDayAudio({
    feedDate: feedDateIso,
    pictureKey: picture.pictureKey,
  });
  const previousReadyAudio =
    shouldReuseExistingPictureAudio(existing) ? existing : null;

  if (shouldReuseExistingPictureAudio(existing)) {
    return {
      status: "already_exists",
      audio: existing,
      feedDate: feedDateIso,
      title: existing.title || title,
    };
  }

  const claim = await fetchMutation(
    anyApi.pictureOfDay.claimPictureOfDayAudioJob,
    await withPictureOfDayWriteAttestation("claim-job", {
      feedDate: feedDateIso,
      pictureKey: picture.pictureKey,
      scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
      owner,
      leaseMs: JOB_LEASE_MS,
    }),
  );

  if (!claim.claimed) {
    const latest = await getPictureOfDayAudio({
      feedDate: feedDateIso,
      pictureKey: picture.pictureKey,
    });

    if (shouldReuseExistingPictureAudio(latest)) {
      return {
        status: "already_exists",
        audio: latest,
        feedDate: feedDateIso,
        title: latest.title || title,
      };
    }

    return {
      status: "pending",
      audio: latest,
      feedDate: feedDateIso,
      title,
    };
  }

  try {
    stage = "building_script";
    spokenText = buildPictureOfDaySpeechScript({
      feedDateIso,
      picture,
    });

    if (!previousReadyAudio) {
      stage = "saving_pending";
      await fetchMutation(
        anyApi.pictureOfDay.savePictureOfDayAudio,
        await withPictureOfDayWriteAttestation("save-record", {
          feedDate: feedDateIso,
          pictureKey: picture.pictureKey,
          scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
          owner,
          status: "pending",
          title,
          spokenText,
        }),
      );
    }

    console.info(
      `[picture-of-day ${feedDateIso} run=${runId}] generating audio for ${picture.pictureKey}`,
    );

    stage = "generating_tts_audio";
    const generatedAudio = await generateTtsAudioWithMetadata(
      { text: spokenText, provider: "edge" },
      {
        apiBaseUrl: baseUrl,
        headers: getEdgeTtsGenerationHeaders(baseUrl),
      },
    );
    const sourceAudioBlob = generatedAudio.blob;
    const ttsMetadata = generatedAudio.metadata;
    if (!isExactCurrentEdgeAudioMetadata(ttsMetadata)) {
      throw new Error(
        "Picture of the Day narration returned a non-Edge TTS profile.",
      );
    }

    stage = "tagging_audio";
    const taggedAudioBlob = await addMp3MetadataToBlob(sourceAudioBlob, {
      title,
      artist: "Curio Garden",
      album: PICTURE_OF_DAY_ALBUM,
    });

    stage = "requesting_upload_url";
    const uploadUrl = await fetchMutation(
      anyApi.pictureOfDay.generateUploadUrl,
      await withPictureOfDayWriteAttestation("generate-upload-url", {}),
    );

    stage = "uploading_audio";
    const storageId: Id<"_storage"> = await uploadBlobToConvexStorage(
      uploadUrl,
      taggedAudioBlob,
    );

    stage = "saving_ready";
    await fetchMutation(
      anyApi.pictureOfDay.savePictureOfDayAudio,
      await withPictureOfDayWriteAttestation("save-record", {
        feedDate: feedDateIso,
        pictureKey: picture.pictureKey,
        scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
        owner,
        status: "ready",
        title,
        spokenText,
        storageId,
        durationSeconds: estimateDurationSeconds(spokenText),
        byteLength: taggedAudioBlob.size,
        voiceId: ttsMetadata.voiceId,
        ttsCacheKey: ttsMetadata.ttsCacheKey,
        provider: ttsMetadata.provider,
        model: ttsMetadata.model,
        promptVersion: ttsMetadata.promptVersion,
        ttsNormVersion: ttsMetadata.ttsNormVersion,
      }),
    );
    committedReady = true;

    stage = "reloading_saved_audio";
    const saved = await getPictureOfDayAudio({
      feedDate: feedDateIso,
      pictureKey: picture.pictureKey,
    });

    if (!saved || saved.status !== "ready" || !saved.audioUrl) {
      throw new Error(
        "Picture of the Day audio was saved but could not be reloaded",
      );
    }

    stage = "finalizing_job";
    const finalization = await fetchMutation(
      anyApi.pictureOfDay.finalizePictureOfDayAudioJob,
      await withPictureOfDayWriteAttestation("finalize-job", {
        feedDate: feedDateIso,
        pictureKey: picture.pictureKey,
        scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
        owner,
        status: "ready",
      }),
    );
    if (!finalization.updated) {
      throw new Error("Picture of the Day audio publication lease was lost.");
    }

    console.info(
      `[picture-of-day ${feedDateIso} run=${runId}] success bytes=${taggedAudioBlob.size}`,
    );

    return {
      status: "created",
      audio: saved,
      feedDate: feedDateIso,
      title: saved.title || title,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const detailedMessage = `[${stage}] ${message}`;

    console.error(
      `[picture-of-day ${feedDateIso} run=${runId}] failed at stage=${stage}: ${message}`,
      error,
    );

    if (!previousReadyAudio && !committedReady) {
      try {
        await fetchMutation(
          anyApi.pictureOfDay.savePictureOfDayAudio,
          await withPictureOfDayWriteAttestation("save-record", {
            feedDate: feedDateIso,
            pictureKey: picture.pictureKey,
            scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
            owner,
            status: "failed",
            title,
            spokenText,
            lastError: detailedMessage,
          }),
        );
      } catch (saveError) {
        console.warn(
          `[picture-of-day ${feedDateIso} run=${runId}] failed to persist failure state`,
          saveError,
        );
      }
    }

    try {
      const finalization = await fetchMutation(
        anyApi.pictureOfDay.finalizePictureOfDayAudioJob,
        await withPictureOfDayWriteAttestation("finalize-job", {
          feedDate: feedDateIso,
          pictureKey: picture.pictureKey,
          scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
          owner,
          status: "failed",
          lastError: detailedMessage,
        }),
      );
      if (!finalization.updated) {
        console.warn(
          `[picture-of-day ${feedDateIso} run=${runId}] failure finalization skipped after lease loss`,
        );
      }
    } catch (finalizeError) {
      console.warn(
        `[picture-of-day ${feedDateIso} run=${runId}] failed to finalize failed job`,
        finalizeError,
      );
    }

    throw new Error(detailedMessage);
  }
};

export const syncPictureOfDayAudio = async ({
  baseUrl,
  feedDateIso,
  picture,
}: {
  baseUrl: string;
  feedDateIso: string;
  picture: WikipediaPictureOfDay;
}): Promise<PictureOfDayAudioSyncResult> => {
  const resolvedFeedDate = resolvePictureOfDayFeedDateIso(feedDateIso);
  const existing = await getPictureOfDayAudio({
    feedDate: resolvedFeedDate,
    pictureKey: picture.pictureKey,
  });

  if (shouldReuseExistingPictureAudio(existing)) {
    return {
      status: "already_exists",
      audio: existing,
      feedDate: resolvedFeedDate,
      title: existing.title || buildPictureOfDayAudioTitle(resolvedFeedDate),
    };
  }

  const storageKey = getStorageKey({
    feedDate: resolvedFeedDate,
    pictureKey: picture.pictureKey,
    scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
  });
  const inFlight = inFlightPictureAudio.get(storageKey);
  if (inFlight) return inFlight;

  const generationPromise = generatePictureOfDayAudioRecord({
    baseUrl,
    feedDateIso: resolvedFeedDate,
    picture,
  }).finally(() => {
    inFlightPictureAudio.delete(storageKey);
  });

  inFlightPictureAudio.set(storageKey, generationPromise);
  return generationPromise;
};

export const getPictureOfDayAudioState = async ({
  feedDateIso,
  picture,
}: {
  feedDateIso?: string;
  picture: WikipediaPictureOfDay;
}): Promise<WikipediaPictureOfDay["audio"]> => {
  const resolvedFeedDate = resolvePictureOfDayFeedDateIso(feedDateIso);
  const record = await getPictureOfDayAudio({
    feedDate: resolvedFeedDate,
    pictureKey: picture.pictureKey,
  });

  if (!record) {
    return { status: "missing", audioUrl: null };
  }

  const hasCurrentReadyAudio = shouldReuseExistingPictureAudio(record);

  return {
    status:
      record.status === "ready"
        ? hasCurrentReadyAudio
          ? "ready"
          : "failed"
        : record.status,
    audioUrl: hasCurrentReadyAudio ? record.audioUrl : null,
    durationSeconds: hasCurrentReadyAudio
      ? record.durationSeconds
      : undefined,
    lastError: record.lastError,
  };
};

export const syncCurrentPictureOfDayAudio = async ({
  baseUrl,
  feedDateIso,
}: {
  baseUrl: string;
  feedDateIso?: string;
}): Promise<PictureOfDayAudioSyncResult> => {
  const resolvedFeedDate = resolvePictureOfDayFeedDateIso(feedDateIso);
  const title = buildPictureOfDayAudioTitle(resolvedFeedDate);
  const snapshot = await getTodayWikipediaData({
    allowLiveFallback: true,
    feedDateIso: resolvedFeedDate,
  });

  if (!snapshot?.pictureOfDay) {
    return {
      status: "missing_source",
      audio: null,
      feedDate: resolvedFeedDate,
      title,
    };
  }

  return syncPictureOfDayAudio({
    baseUrl,
    feedDateIso: resolvedFeedDate,
    picture: snapshot.pictureOfDay,
  });
};
