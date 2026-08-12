import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assembleAccountDataExport,
  getAccountDataExportFilename,
  type ListeningProgressExport,
} from "./account-data-export";

const requestFetch = vi.fn();

const convexSuccess = (value: unknown) =>
  new Response(JSON.stringify({ status: "success", value, logLines: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const clerkUser = {
  id: "user_123",
  firstName: "Samwise",
  lastName: "Gamgee",
  username: "gardener",
  imageUrl: "https://images.example.com/samwise.jpg",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_710_000_000_000,
  lastSignInAt: 1_720_000_000_000,
  emailAddresses: [
    {
      id: "email_1",
      emailAddress: "sam@example.com",
      verification: { status: "verified", secret: "email-secret" },
    },
  ],
  phoneNumbers: [
    {
      id: "phone_1",
      phoneNumber: "+15555550123",
      reservedForSecondFactor: true,
      verification: { status: "verified", secret: "phone-secret" },
    },
  ],
  privateMetadata: { recoveryCode: "clerk-private-secret" },
  publicMetadata: { internalCohort: "founder" },
  unsafeMetadata: { untrusted: true },
  externalAccounts: [{ provider: "oauth_google", accessToken: "oauth-secret" }],
};

describe("account data export assembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "NEXT_PUBLIC_CONVEX_URL",
      "https://curio-garden-test.convex.cloud",
    );
    vi.stubGlobal("fetch", requestFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses a stable UTC-dated filename", () => {
    expect(
      getAccountDataExportFilename(new Date("2026-07-27T23:59:59.999Z")),
    ).toBe("curio-garden-account-data-2026-07-27.json");
  });

  it("builds a versioned manifest from an explicit Clerk allowlist and server data", async () => {
    const overview = {
      feed: {
        status: "active" as const,
        feedToken: "a".repeat(64),
        createdAt: 1_730_000_000_000,
        updatedAt: 1_740_000_000_000,
      },
      quotas: [
        {
          feature: "personalPlaylist" as const,
          count: 2,
          windowStart: 1_750_000_000_000,
          expiresAt: 1_750_086_400_000,
          createdAt: 1_750_000_000_000,
          updatedAt: 1_750_000_001_000,
        },
      ],
    };
    const bookmark = {
      slug: "The_Shire",
      title: "The Shire",
      savedAt: 1_760_000_000_000,
      updatedAt: 1_760_000_001_000,
    };
    const articleAudioExport = {
      slug: "There_and_Back_Again",
      title: "There and Back Again",
      status: "ready" as const,
      sectionCount: 12,
      completedSectionCount: 12,
      ttsProvider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      createdAt: 1_760_000_002_000,
      updatedAt: 1_760_000_003_000,
    };
    const listeningProgress = {
      wikiPageId: "wiki-1",
      slug: "The_Shire",
      title: "The Shire",
      totalDurationSeconds: 120,
      heardSeconds: 30,
      sections: [
        {
          sectionKey: "summary",
          durationSeconds: 60,
          heardRanges: [{ startSecond: 0, endSecond: 30 }],
        },
      ],
      meaningfulUseSession: {
        startedAt: 1_760_000_004_000,
        expiresAt: 1_760_007_204_000,
        sections: [
          {
            sectionKey: "summary",
            durationSeconds: 60,
            heardRanges: [{ startSecond: 0, endSecond: 30 }],
          },
        ],
      },
      resumeCursor: {
        wikiPageId: "wiki-1",
        revisionId: "revision-7",
        narrationVersion: 3,
        mode: "all",
        sectionKey: "section-1",
        positionSeconds: 27,
        durationSeconds: 120,
        cursorVersion: 4,
        updatedAt: 1_760_000_004_500,
      },
      createdAt: 1_760_000_004_000,
      updatedAt: 1_760_000_005_000,
    } satisfies ListeningProgressExport;

    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [Record<string, unknown>];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess(overview);
        }
        const args = body.args[0];
        return convexSuccess({
          page:
            args.collection === "bookmarks"
              ? [bookmark]
              : args.collection === "listeningProgress"
                ? [listeningProgress]
                : args.collection === "articleAudioExports"
                  ? [articleAudioExport]
                  : [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );

    const manifest = await assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T12:34:56.789Z"),
    });

    expect(manifest).toEqual({
      format: "curio-garden-account-export",
      version: 1,
      exportedAt: "2026-07-27T12:34:56.789Z",
      account: {
        id: "user_123",
        firstName: "Samwise",
        lastName: "Gamgee",
        username: "gardener",
        imageUrl: "https://images.example.com/samwise.jpg",
        createdAt: 1_700_000_000_000,
        updatedAt: 1_710_000_000_000,
        lastSignInAt: 1_720_000_000_000,
        emailAddresses: [{ id: "email_1", emailAddress: "sam@example.com" }],
        phoneNumbers: [{ id: "phone_1", phoneNumber: "+15555550123" }],
      },
      data: {
        bookmarks: [bookmark],
        personalPodcastFeed: overview.feed,
        personalPlaylistEpisodes: [],
        listeningProgress: [listeningProgress],
        badgeCredits: [],
        articleAudioExports: [articleAudioExport],
        quotaUsage: overview.quotas,
      },
      scope: {
        serverSideDataOnly: true,
        audioBinariesIncluded: false,
        privateFeedTokenIncluded: true,
        exclusions: [
          "Data stored only in this browser or device",
          "Shared article, narration, and audio caches",
          "Aggregate analytics that cannot be linked to this account",
          "Anonymous feedback that is not linked to this account",
        ],
      },
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      /clerk-private-secret|oauth-secret|email-secret|phone-secret/u,
    );
    expect(requestFetch).toHaveBeenCalledTimes(6);
    for (const [, init] of requestFetch.mock.calls as Array<
      [string, RequestInit]
    >) {
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer convex-jwt",
      );
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("follows every pagination cursor before finalizing a collection", async () => {
    const firstBookmark = {
      slug: "Bag_End",
      title: "Bag End",
      savedAt: 10,
      updatedAt: 11,
    };
    const secondBookmark = {
      slug: "Rivendell",
      title: "Rivendell",
      savedAt: 12,
      updatedAt: 13,
    };

    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [
            {
              collection?: string;
              paginationOpts?: { cursor: string | null; numItems: number };
            },
          ];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }

        const args = body.args[0];
        if (args.collection === "bookmarks") {
          return args.paginationOpts?.cursor === null
            ? convexSuccess({
                page: [firstBookmark],
                continueCursor: "bookmark-cursor-1",
                isDone: false,
              })
            : convexSuccess({
                page: [secondBookmark],
                continueCursor: "bookmark-done",
                isDone: true,
              });
        }
        return convexSuccess({
          page: [],
          continueCursor: `${args.collection}-done`,
          isDone: true,
        });
      },
    );

    const manifest = await assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(manifest.data.bookmarks).toEqual([firstBookmark, secondBookmark]);
    const bookmarkRequests = requestFetch.mock.calls
      .map(
        ([, init]) =>
          JSON.parse(String((init as RequestInit).body)) as {
            path: string;
            args: [{ paginationOpts?: { cursor: string | null } }];
          },
      )
      .filter((body) => body.path.endsWith("getViewerAccountDataPage"))
      .filter(
        (body) =>
          (
            body.args[0] as {
              collection?: string;
              paginationOpts?: { cursor: string | null };
            }
          ).collection === "bookmarks",
      );
    expect(
      bookmarkRequests.map((body) => body.args[0].paginationOpts?.cursor),
    ).toEqual([null, "bookmark-cursor-1"]);
  });

  it("fails the whole export when a collection cursor stops advancing", async () => {
    let bookmarkRequests = 0;
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [{ collection?: string }];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }
        if (body.args[0].collection === "bookmarks") {
          bookmarkRequests += 1;
          if (bookmarkRequests > 2) {
            throw new Error("pagination should have stopped");
          }
          return convexSuccess({
            page: [],
            continueCursor: "stuck-cursor",
            isDone: false,
          });
        }
        return convexSuccess({
          page: [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );

    await expect(
      assembleAccountDataExport({
        clerkUser,
        convexToken: "convex-jwt",
        exportedAt: new Date("2026-07-27T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Account data export could not be assembled");
    expect(bookmarkRequests).toBe(2);
  });

  it("fails the whole export when an unfinished page omits its next cursor", async () => {
    let bookmarkRequests = 0;
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [{ collection?: string }];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }
        if (body.args[0].collection === "bookmarks") {
          bookmarkRequests += 1;
          return convexSuccess({ page: [], isDone: false });
        }
        return convexSuccess({
          page: [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );

    await expect(
      assembleAccountDataExport({
        clerkUser,
        convexToken: "convex-jwt",
        exportedAt: new Date("2026-07-27T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Account data export could not be assembled");
    expect(bookmarkRequests).toBe(1);
  });

  it("replaces an incomplete Convex page with both split halves before later pages", async () => {
    const progress = (slug: string) => ({
      wikiPageId: slug,
      slug,
      title: slug,
      totalDurationSeconds: 100,
      heardSeconds: 50,
      sections: [],
      createdAt: 1,
      updatedAt: 2,
    });
    const listeningPageRequests: Array<{
      cursor: string | null;
      endCursor?: string;
      numItems: number;
    }> = [];
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [
            {
              collection?: string;
              paginationOpts?: {
                cursor: string | null;
                endCursor?: string;
                numItems: number;
              };
            },
          ];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }
        if (body.args[0].collection === "listeningProgress") {
          const paginationOpts = body.args[0].paginationOpts!;
          listeningPageRequests.push(paginationOpts);
          if (paginationOpts.cursor === null && !paginationOpts.endCursor) {
            return convexSuccess({
              page: [progress("partial-must-be-discarded")],
              continueCursor: "whole-page-end",
              splitCursor: "split-point",
              pageStatus: "SplitRequired",
              isDone: false,
            });
          }
          if (
            paginationOpts.cursor === null &&
            paginationOpts.endCursor === "split-point"
          ) {
            return convexSuccess({
              page: [progress("first-half")],
              continueCursor: "split-point",
              isDone: false,
            });
          }
          if (
            paginationOpts.cursor === "split-point" &&
            paginationOpts.endCursor === "whole-page-end"
          ) {
            return convexSuccess({
              page: [progress("second-half")],
              continueCursor: "whole-page-end",
              isDone: false,
            });
          }
          if (
            paginationOpts.cursor === "whole-page-end" &&
            !paginationOpts.endCursor
          ) {
            return convexSuccess({
              page: [progress("later-page")],
              continueCursor: "done",
              isDone: true,
            });
          }
          throw new Error("Unexpected listening pagination range");
        }
        return convexSuccess({
          page: [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );

    const manifest = await assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(manifest.data.listeningProgress.map(({ slug }) => slug)).toEqual([
      "first-half",
      "second-half",
      "later-page",
    ]);
    expect(listeningPageRequests).toEqual([
      { cursor: null, numItems: 100 },
      { cursor: null, endCursor: "split-point", numItems: 100 },
      {
        cursor: "split-point",
        endCursor: "whole-page-end",
        numItems: 100,
      },
      { cursor: "whole-page-end", numItems: 100 },
    ]);
  });

  it("marks a revoked feed token as absent from the archive", async () => {
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { path: string };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({
            feed: {
              status: "revoked",
              feedToken: null,
              createdAt: 1,
              updatedAt: 3,
              revokedAt: 2,
            },
            quotas: [],
          });
        }
        return convexSuccess({
          page: [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );

    const manifest = await assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(manifest.data.personalPodcastFeed).toEqual({
      status: "revoked",
      feedToken: null,
      createdAt: 1,
      updatedAt: 3,
      revokedAt: 2,
    });
    expect(manifest.scope.privateFeedTokenIncluded).toBe(false);
  });

  it("fails before the route limit when many individually healthy pages run long", async () => {
    vi.useFakeTimers();
    let bookmarkPage = 0;
    let latestBookmarkSignal: AbortSignal | undefined;
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [{ collection?: string }];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }
        if (body.args[0].collection !== "bookmarks") {
          return convexSuccess({
            page: [],
            continueCursor: "done",
            isDone: true,
          });
        }

        bookmarkPage += 1;
        const pageNumber = bookmarkPage;
        const bookmarkSignal = init?.signal as AbortSignal;
        latestBookmarkSignal = bookmarkSignal;
        return await new Promise<Response>((resolve, reject) => {
          const responseTimer = setTimeout(() => {
            if (pageNumber === 8) {
              reject(new Error("Test fallback stop"));
              return;
            }
            resolve(
              convexSuccess({
                page: [],
                continueCursor: `bookmark-cursor-${pageNumber}`,
                isDone: false,
              }),
            );
          }, 7_000);
          bookmarkSignal.addEventListener(
            "abort",
            () => {
              clearTimeout(responseTimer);
              reject(bookmarkSignal.reason);
            },
            { once: true },
          );
        });
      },
    );

    let settled = false;
    const exportRequest = assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T00:00:00.000Z"),
    }).catch((error: unknown) => error);
    void exportRequest.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(45_000);
    const settledAtSharedDeadline = settled;
    if (!settled) await vi.advanceTimersByTimeAsync(15_000);
    const error = await exportRequest;

    expect(settledAtSharedDeadline).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Account data export could not be assembled",
    );
    expect(latestBookmarkSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts sibling collection requests when any export query fails", async () => {
    vi.useFakeTimers();
    const siblingSignals: AbortSignal[] = [];
    const overviewError = new Error("Overview failed");
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { path: string };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          throw overviewError;
        }

        const signal = init?.signal as AbortSignal;
        siblingSignals.push(signal);
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );

    const error = await assembleAccountDataExport({
      clerkUser,
      convexToken: "convex-jwt",
      exportedAt: new Date("2026-07-27T00:00:00.000Z"),
    }).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(0);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Account data export could not be assembled",
    );
    expect((error as Error).cause).toBe(overviewError);
    expect(siblingSignals).toHaveLength(5);
    expect(siblingSignals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
