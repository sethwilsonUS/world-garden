// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  feedState: {
    status: "active" as const,
    feedToken: "a".repeat(64),
    updatedAt: 1,
  },
  revokeFeed: vi.fn(),
  rotateFeed: vi.fn(),
  retryEpisode: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    personalPlaylist: {
      addViewerPlaylistEpisodeBySlug: "add",
      getViewerFeedState: "feed-state",
      listViewerPlaylistEpisodes: "list",
      moveViewerPlaylistEpisode: "move",
      removeViewerPlaylistEpisode: "remove",
      revokeViewerFeedToken: "revoke-feed",
      retryViewerPlaylistEpisode: "retry",
      rotateViewerFeedToken: "rotate-feed",
    },
  },
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: (reference: string) => {
    if (reference === "retry") return mocks.retryEpisode;
    if (reference === "rotate-feed") return mocks.rotateFeed;
    if (reference === "revoke-feed") return mocks.revokeFeed;
    return vi.fn();
  },
  useQuery: (reference: string) =>
    reference === "list" ? [] : mocks.feedState,
}));

import {
  PersonalPlaylistProvider,
  usePersonalPlaylist,
} from "./usePersonalPlaylist";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let retryFromContext:
  | ((episodeId: string, title: string) => Promise<void>)
  | undefined;
let rotateFeedFromContext: (() => Promise<void>) | undefined;
let revokeFeedFromContext: (() => Promise<void>) | undefined;
let currentFeedStatus: string | undefined;
let currentFeedUrl: string | null | undefined;

const Probe = () => {
  const { feedStatus, feedUrl, retry, revokeFeed, rotateFeed } =
    usePersonalPlaylist();
  useEffect(() => {
    retryFromContext = retry;
    rotateFeedFromContext = rotateFeed;
    revokeFeedFromContext = revokeFeed;
    currentFeedStatus = feedStatus;
    currentFeedUrl = feedUrl;
  }, [feedStatus, feedUrl, retry, revokeFeed, rotateFeed]);
  return null;
};

describe("PersonalPlaylistProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.retryEpisode.mockReset();
    mocks.rotateFeed.mockReset();
    mocks.revokeFeed.mockReset();
    mocks.rotateFeed.mockResolvedValue({
      status: "active",
      feedToken: "b".repeat(64),
      updatedAt: 2,
    });
    mocks.revokeFeed.mockResolvedValue({
      status: "revoked",
      feedToken: null,
      updatedAt: 2,
    });
    retryFromContext = undefined;
    rotateFeedFromContext = undefined;
    revokeFeedFromContext = undefined;
    currentFeedStatus = undefined;
    currentFeedUrl = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <PersonalPlaylistProvider>
          <Probe />
        </PersonalPlaylistProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("surfaces retry quota failures in the assertive live region", async () => {
    const quotaMessage =
      "Personal Playlist queue is full. Wait for an episode to finish before adding another.";
    mocks.retryEpisode.mockRejectedValueOnce(new Error(quotaMessage));

    await expect(
      act(async () => {
        await retryFromContext?.("episode-1", "Mars");
      }),
    ).resolves.toBeUndefined();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      quotaMessage,
    );
  });

  it("keeps successful retries in the polite live region", async () => {
    mocks.retryEpisode.mockResolvedValueOnce({ queued: true });

    await act(async () => {
      await retryFromContext?.("episode-1", "Mars");
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Mars is queued for regeneration.",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("");
  });

  it("exposes active feed state and rotates with an identity-scoped mutation", async () => {
    expect(currentFeedStatus).toBe("active");
    expect(currentFeedUrl).toBe(
      `http://localhost:3000/api/podcast/personal.xml?token=${"a".repeat(64)}`,
    );

    await act(async () => {
      await rotateFeedFromContext?.();
    });

    expect(mocks.rotateFeed).toHaveBeenCalledWith({});
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Your private feed URL was replaced. The old address no longer works. Copy the new address into your podcast app.",
    );
  });

  it("revokes with an identity-scoped mutation and announces that the playlist remains", async () => {
    await act(async () => {
      await revokeFeedFromContext?.();
    });

    expect(mocks.revokeFeed).toHaveBeenCalledWith({});
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Your private feed is off. Your playlist is still here.",
    );
  });

  it("announces feed lifecycle failures assertively", async () => {
    mocks.rotateFeed.mockRejectedValueOnce(
      new Error("Could not replace your private feed URL."),
    );

    let rejection: unknown;
    await act(async () => {
      try {
        await rotateFeedFromContext?.();
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toEqual(
      new Error("Could not replace your private feed URL."),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not replace your private feed URL.",
    );
  });
});
