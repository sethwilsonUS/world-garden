import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { shouldUseOnThisDaySnapshotCache } from "@/lib/on-this-day-snapshot";
import {
  createPublicAudioWriteAttestation,
  type PublicAudioWriteOperation,
} from "@/lib/public-audio-write-attestation";

export type StoredOnThisDayShareCardPlate = {
  year?: number;
  articleTitle: string;
  imageUrl: string;
  licenseName?: string;
  creator?: string;
  sourceUrl?: string;
};

export type StoredOnThisDayShareCard = {
  monthDay: string;
  version: number;
  storageId: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  generatedAt: number;
  snapshotCheckedAt?: number;
  plates: StoredOnThisDayShareCardPlate[];
  imageUrl: string | null;
};

export type OnThisDayShareCardStatus = {
  monthDay: string;
  version: number;
  generatedAt: number;
  byteSize: number;
  plateCount: number;
};

export type UploadAndSaveOnThisDayShareCardInput = {
  monthDay: string;
  version: number;
  data: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  generatedAt?: number;
  snapshotCheckedAt?: number;
  plates: StoredOnThisDayShareCardPlate[];
};

export type UploadAndSaveOnThisDayShareCardResult = {
  monthDay: string;
  version: number;
  storageId: string;
  replaced: boolean;
};

const withOnThisDayWriteAttestation = async <
  TArgs extends Record<string, unknown>,
>(
  operation: PublicAudioWriteOperation,
  args: TArgs,
) => ({
  ...args,
  attestation: await createPublicAudioWriteAttestation({
    pipeline: "on-this-day",
    operation,
    args,
  }),
});

const normalizeShareCardPlate = (
  plate: StoredOnThisDayShareCardPlate,
): StoredOnThisDayShareCardPlate => {
  const normalized: StoredOnThisDayShareCardPlate = {
    articleTitle: plate.articleTitle,
    imageUrl: plate.imageUrl,
  };
  if (plate.year !== undefined) normalized.year = plate.year;
  if (plate.licenseName !== undefined) {
    normalized.licenseName = plate.licenseName;
  }
  if (plate.creator !== undefined) normalized.creator = plate.creator;
  if (plate.sourceUrl !== undefined) normalized.sourceUrl = plate.sourceUrl;
  return normalized;
};

const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<string> => {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });

  if (!result.ok) {
    throw new Error(`Convex storage upload failed: ${result.status}`);
  }

  const body = (await result.json()) as { storageId?: string };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId;
};

export const getStoredOnThisDayShareCard = async (
  monthDay: string,
): Promise<StoredOnThisDayShareCard | null> => {
  if (!shouldUseOnThisDaySnapshotCache()) return null;
  const card = (await fetchQuery(anyApi.onThisDay.getShareCardByMonthDay, {
    monthDay,
  })) as StoredOnThisDayShareCard | null;
  return card ?? null;
};

export const listStoredOnThisDayShareCardStatuses = async (): Promise<
  OnThisDayShareCardStatus[]
> => {
  if (!shouldUseOnThisDaySnapshotCache()) return [];
  const rows = (await fetchQuery(
    anyApi.onThisDay.listShareCardStatuses,
    {},
  )) as OnThisDayShareCardStatus[] | null;
  return rows ?? [];
};

export const uploadAndSaveOnThisDayShareCard = async ({
  monthDay,
  version,
  data,
  mimeType,
  width,
  height,
  generatedAt = Date.now(),
  snapshotCheckedAt,
  plates,
}: UploadAndSaveOnThisDayShareCardInput): Promise<UploadAndSaveOnThisDayShareCardResult> => {
  if (!shouldUseOnThisDaySnapshotCache()) {
    throw new Error(
      "Cannot upload On This Day share card when Convex storage is disabled (check NEXT_PUBLIC_LOCAL_MODE and NEXT_PUBLIC_CONVEX_URL).",
    );
  }
  if (data.byteLength === 0) {
    throw new Error("Cannot upload an empty On This Day share card image.");
  }

  const uploadArgs = await withOnThisDayWriteAttestation(
    "generate-upload-url",
    {},
  );
  const uploadUrl = (await fetchMutation(
    anyApi.onThisDay.generateShareCardUploadUrl,
    uploadArgs,
  )) as string | null;

  if (typeof uploadUrl !== "string" || uploadUrl.length === 0) {
    throw new Error(
      `Convex generateShareCardUploadUrl did not return an upload URL for ${monthDay}`,
    );
  }

  const blob = new Blob([Buffer.from(data)], { type: mimeType });
  const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);

  const saveArgs: {
    monthDay: string;
    version: number;
    storageId: string;
    mimeType: string;
    width: number;
    height: number;
    byteSize: number;
    generatedAt: number;
    snapshotCheckedAt?: number;
    plates: StoredOnThisDayShareCardPlate[];
  } = {
    monthDay,
    version,
    storageId,
    mimeType,
    width,
    height,
    byteSize: data.byteLength,
    generatedAt,
    plates: plates.map(normalizeShareCardPlate),
  };
  if (snapshotCheckedAt !== undefined) {
    saveArgs.snapshotCheckedAt = snapshotCheckedAt;
  }

  const saved = (await fetchMutation(
    anyApi.onThisDay.saveShareCard,
    await withOnThisDayWriteAttestation("save-show-asset", saveArgs),
  )) as UploadAndSaveOnThisDayShareCardResult | null;

  if (!saved?.storageId) {
    throw new Error(
      `Convex saveShareCard did not return a valid result for ${monthDay}`,
    );
  }

  return saved;
};
