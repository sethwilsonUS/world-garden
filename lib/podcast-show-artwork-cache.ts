import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { Id } from "@/convex/_generated/dataModel";
import {
  FEATURED_SHOW_ARTWORK_VERSION,
  PERSONAL_SHOW_ARTWORK_VERSION,
  TRENDING_SHOW_ARTWORK_VERSION,
} from "@/lib/podcast-feed";

type ShowSlug = "featured" | "trending" | "personal";

type StoredShowAsset = {
  storageId: string;
  mimeType: string;
  version?: number;
  artworkUrl?: string | null;
};

const SHOW_ARTWORK_VERSIONS: Record<ShowSlug, number> = {
  featured: FEATURED_SHOW_ARTWORK_VERSION,
  trending: TRENDING_SHOW_ARTWORK_VERSION,
  personal: PERSONAL_SHOW_ARTWORK_VERSION,
};

const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<Id<"_storage">> => {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/png" },
    body: blob,
  });

  if (!result.ok) {
    throw new Error(`Convex storage upload failed: ${result.status}`);
  }

  const body = (await result.json()) as { storageId?: string };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId as Id<"_storage">;
};

export const getOrCreatePodcastShowArtworkUrl = async ({
  slug,
  render,
}: {
  slug: ShowSlug;
  render: () => Promise<{ data: Uint8Array; mimeType: string }>;
}): Promise<string> => {
  const version = SHOW_ARTWORK_VERSIONS[slug];
  const existing = (await fetchQuery(anyApi.podcast.getPodcastShowAsset, {
    slug,
  })) as StoredShowAsset | null;

  if (existing?.artworkUrl && existing.version === version) {
    return existing.artworkUrl;
  }

  const [uploadUrl, artwork] = await Promise.all([
    fetchMutation(anyApi.podcast.generateUploadUrl, {}),
    render(),
  ]);

  const blob = new Blob([Buffer.from(artwork.data)], { type: artwork.mimeType });
  const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);

  await fetchMutation(anyApi.podcast.savePodcastShowAsset, {
    slug,
    storageId: storageId as Id<"_storage">,
    mimeType: artwork.mimeType,
    version,
  });

  const saved = (await fetchQuery(anyApi.podcast.getPodcastShowAsset, {
    slug,
  })) as StoredShowAsset | null;

  if (!saved?.artworkUrl) {
    throw new Error(`Stored ${slug} podcast artwork could not be reloaded`);
  }

  return saved.artworkUrl;
};
