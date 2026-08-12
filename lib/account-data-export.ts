import "server-only";

import { anyApi } from "convex/server";
import { fetchConvexQueryWithTimeout } from "@/lib/convex-request-timeout";

const ACCOUNT_DATA_PAGE_SIZE = 100;
const MAX_ACCOUNT_DATA_PAGES_PER_COLLECTION = 1_000;
const ACCOUNT_DATA_QUERY_TIMEOUT_MS = 8_000;
const ACCOUNT_DATA_EXPORT_TIMEOUT_MS = 45_000;
const ACCOUNT_DATA_QUERY_TIMEOUT_MESSAGE = "Account data lookup timed out";
const ACCOUNT_DATA_EXPORT_TIMEOUT_MESSAGE = "Account data export timed out";

export type AccountExportClerkUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
  lastSignInAt: number | null;
  emailAddresses: ReadonlyArray<{ id: string; emailAddress: string }>;
  phoneNumbers: ReadonlyArray<{ id: string; phoneNumber: string }>;
};

type BookmarkExport = {
  slug: string;
  title: string;
  savedAt: number;
  updatedAt: number;
};

type PlaylistEpisodeExport = {
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  position: number;
  publishedAt: number;
  removedAt?: number;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount?: number;
  completedSectionCount?: number;
  durationSeconds?: number;
  byteLength?: number;
  provider?: string;
  model?: string;
  voiceId?: string;
  createdAt: number;
  updatedAt: number;
};

type HeardRangeExport = {
  startSecond: number;
  endSecond: number;
};

export type ListeningProgressExport = {
  wikiPageId: string;
  slug: string;
  title: string;
  totalDurationSeconds: number;
  heardSeconds: number;
  qualifiedAt?: number;
  sections: Array<{
    sectionKey: string;
    durationSeconds: number;
    heardRanges: HeardRangeExport[];
  }>;
  meaningfulUseSession?: {
    startedAt: number;
    expiresAt: number;
    sections: Array<{
      sectionKey: string;
      durationSeconds: number;
      heardRanges: HeardRangeExport[];
    }>;
  };
  resumeCursor?: {
    wikiPageId: string;
    revisionId: string;
    narrationVersion: number;
    mode: "all" | "single";
    sectionKey: string;
    positionSeconds: number;
    durationSeconds: number;
    cursorVersion: number;
    updatedAt: number;
  };
  createdAt: number;
  updatedAt: number;
};

type BadgeCreditExport = {
  wikiPageId: string;
  slug: string;
  title: string;
  badgeKey: string;
  earnedAt: number;
};

type ArticleAudioExport = {
  slug: string;
  title: string;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount: number;
  completedSectionCount: number;
  byteLength?: number;
  ttsProvider?: string;
  model?: string;
  voiceId?: string;
  dismissedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type AccountDataCollectionItems = {
  bookmarks: BookmarkExport;
  playlistEpisodes: PlaylistEpisodeExport;
  listeningProgress: ListeningProgressExport;
  badgeCredits: BadgeCreditExport;
  articleAudioExports: ArticleAudioExport;
};

type AccountDataCollection = keyof AccountDataCollectionItems;

type PersonalPodcastFeedExport = null | {
  status: "active" | "revoked";
  feedToken: string | null;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number;
};

type AccountQuotaExport = {
  feature: "personalPlaylist" | "articleAudioExport";
  count: number;
  windowStart: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type AccountDataOverview = {
  feed: PersonalPodcastFeedExport;
  quotas: AccountQuotaExport[];
};

type AccountDataPage<Collection extends AccountDataCollection> = {
  page: Array<AccountDataCollectionItems[Collection]>;
  continueCursor: string;
  isDone: boolean;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

const ACCOUNT_EXPORT_EXCLUSIONS = [
  "Data stored only in this browser or device",
  "Shared article, narration, and audio caches",
  "Aggregate analytics that cannot be linked to this account",
  "Anonymous feedback that is not linked to this account",
] as const;

const fetchAccountDataQuery = async <Result>(
  query: Parameters<typeof fetchConvexQueryWithTimeout>[0],
  args: Record<string, unknown>,
  convexToken: string,
  signal: AbortSignal,
): Promise<Result> =>
  (await fetchConvexQueryWithTimeout(query, args, {
    timeoutMs: ACCOUNT_DATA_QUERY_TIMEOUT_MS,
    message: ACCOUNT_DATA_QUERY_TIMEOUT_MESSAGE,
    signal,
    token: convexToken,
  })) as Result;

const readCollection = async <Collection extends AccountDataCollection>(
  collection: Collection,
  convexToken: string,
  signal: AbortSignal,
): Promise<Array<AccountDataCollectionItems[Collection]>> => {
  const items: Array<AccountDataCollectionItems[Collection]> = [];
  const requestedRanges = new Set<string>();
  let pageCount = 0;

  const fetchPage = async (
    cursor: string | null,
    endCursor?: string,
  ): Promise<AccountDataPage<Collection>> => {
    pageCount += 1;
    if (pageCount > MAX_ACCOUNT_DATA_PAGES_PER_COLLECTION) {
      throw new Error("Account data pagination exceeded its safe limit");
    }

    const rangeKey = JSON.stringify([cursor, endCursor ?? null]);
    if (requestedRanges.has(rangeKey)) {
      throw new Error("Account data pagination repeated a range");
    }
    requestedRanges.add(rangeKey);

    const result: AccountDataPage<Collection> = await fetchAccountDataQuery<
      AccountDataPage<Collection>
    >(
      anyApi.accountData.getViewerAccountDataPage,
      {
        collection,
        paginationOpts:
          endCursor === undefined
            ? { cursor, numItems: ACCOUNT_DATA_PAGE_SIZE }
            : { cursor, endCursor, numItems: ACCOUNT_DATA_PAGE_SIZE },
      },
      convexToken,
      signal,
    );

    if (!Array.isArray(result.page) || typeof result.isDone !== "boolean") {
      throw new Error("Account data page was malformed");
    }
    if (
      result.pageStatus != null &&
      result.pageStatus !== "SplitRecommended" &&
      result.pageStatus !== "SplitRequired"
    ) {
      throw new Error("Account data page status was invalid");
    }
    return result;
  };

  const validateAdvancingCursor = (
    cursor: string | null,
    nextCursor: unknown,
  ): string => {
    if (
      typeof nextCursor !== "string" ||
      !nextCursor ||
      nextCursor === cursor
    ) {
      throw new Error("Account data pagination did not advance");
    }
    return nextCursor;
  };

  const getSplitRange = (
    result: AccountDataPage<Collection>,
    cursor: string | null,
    requestedEndCursor?: string,
  ): { splitCursor: string; continueCursor: string } => {
    const splitCursor = validateAdvancingCursor(cursor, result.splitCursor);
    const continueCursor = validateAdvancingCursor(
      cursor,
      result.continueCursor,
    );
    if (splitCursor === continueCursor) {
      throw new Error("Account data split range did not advance");
    }
    if (
      requestedEndCursor !== undefined &&
      continueCursor !== requestedEndCursor
    ) {
      throw new Error("Account data split escaped its requested range");
    }
    return { splitCursor, continueCursor };
  };

  const readBoundedRange = async (
    cursor: string | null,
    endCursor: string,
  ): Promise<Array<AccountDataCollectionItems[Collection]>> => {
    if (!endCursor || cursor === endCursor) {
      throw new Error("Account data split range was empty");
    }

    const result = await fetchPage(cursor, endCursor);
    if (result.pageStatus === "SplitRequired") {
      const split = getSplitRange(result, cursor, endCursor);
      const firstHalf = await readBoundedRange(cursor, split.splitCursor);
      const secondHalf = await readBoundedRange(
        split.splitCursor,
        split.continueCursor,
      );
      return [...firstHalf, ...secondHalf];
    }

    const continueCursor = validateAdvancingCursor(
      cursor,
      result.continueCursor,
    );
    if (continueCursor !== endCursor) {
      throw new Error("Account data split range was incomplete");
    }
    return result.page;
  };

  let cursor: string | null = null;
  while (true) {
    const result = await fetchPage(cursor);
    if (result.pageStatus === "SplitRequired") {
      const split = getSplitRange(result, cursor);
      items.push(
        ...(await readBoundedRange(cursor, split.splitCursor)),
        ...(await readBoundedRange(split.splitCursor, split.continueCursor)),
      );
    } else {
      items.push(...result.page);
    }

    if (result.isDone) return items;
    cursor = validateAdvancingCursor(cursor, result.continueCursor);
  }
};

const projectClerkAccount = (clerkUser: AccountExportClerkUser) => ({
  id: clerkUser.id,
  firstName: clerkUser.firstName,
  lastName: clerkUser.lastName,
  username: clerkUser.username,
  imageUrl: clerkUser.imageUrl,
  createdAt: clerkUser.createdAt,
  updatedAt: clerkUser.updatedAt,
  lastSignInAt: clerkUser.lastSignInAt,
  emailAddresses: clerkUser.emailAddresses.map(({ id, emailAddress }) => ({
    id,
    emailAddress,
  })),
  phoneNumbers: clerkUser.phoneNumbers.map(({ id, phoneNumber }) => ({
    id,
    phoneNumber,
  })),
});

export const getAccountDataExportFilename = (exportedAt: Date): string =>
  `curio-garden-account-data-${exportedAt.toISOString().slice(0, 10)}.json`;

export const assembleAccountDataExport = async ({
  clerkUser,
  convexToken,
  exportedAt = new Date(),
  signal: parentSignal,
}: {
  clerkUser: AccountExportClerkUser;
  convexToken: string;
  exportedAt?: Date;
  signal?: AbortSignal;
}) => {
  const controller = new AbortController();
  const abortExport = (reason?: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const abortFromParent = () => abortExport(parentSignal?.reason);
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeoutId = setTimeout(
    () => abortExport(new Error(ACCOUNT_DATA_EXPORT_TIMEOUT_MESSAGE)),
    ACCOUNT_DATA_EXPORT_TIMEOUT_MS,
  );

  try {
    if (!convexToken.trim()) throw new Error("Missing Convex token");
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("Account export cancelled");
    }

    const [
      overview,
      bookmarks,
      personalPlaylistEpisodes,
      listeningProgress,
      badgeCredits,
      articleAudioExports,
    ] = await Promise.all([
      fetchAccountDataQuery<AccountDataOverview>(
        anyApi.accountData.getViewerAccountDataOverview,
        {},
        convexToken,
        controller.signal,
      ),
      readCollection("bookmarks", convexToken, controller.signal),
      readCollection("playlistEpisodes", convexToken, controller.signal),
      readCollection("listeningProgress", convexToken, controller.signal),
      readCollection("badgeCredits", convexToken, controller.signal),
      readCollection("articleAudioExports", convexToken, controller.signal),
    ]);
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("Account export cancelled");
    }

    return {
      format: "curio-garden-account-export" as const,
      version: 1 as const,
      exportedAt: exportedAt.toISOString(),
      account: projectClerkAccount(clerkUser),
      data: {
        bookmarks,
        personalPodcastFeed: overview.feed,
        personalPlaylistEpisodes,
        listeningProgress,
        badgeCredits,
        articleAudioExports,
        quotaUsage: overview.quotas,
      },
      scope: {
        serverSideDataOnly: true as const,
        audioBinariesIncluded: false as const,
        privateFeedTokenIncluded: Boolean(
          overview.feed?.status === "active" && overview.feed.feedToken,
        ),
        exclusions: [...ACCOUNT_EXPORT_EXCLUSIONS],
      },
    };
  } catch (error) {
    abortExport(error);
    throw new Error("Account data export could not be assembled", {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
};
