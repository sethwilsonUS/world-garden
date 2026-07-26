// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retryEpisode: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    personalPlaylist: {
      addViewerPlaylistEpisodeBySlug: "add",
      getViewerFeedToken: "feed",
      listViewerPlaylistEpisodes: "list",
      moveViewerPlaylistEpisode: "move",
      removeViewerPlaylistEpisode: "remove",
      retryViewerPlaylistEpisode: "retry",
    },
  },
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: (reference: string) =>
    reference === "retry" ? mocks.retryEpisode : vi.fn(),
  useQuery: (reference: string) => (reference === "list" ? [] : "feed-token"),
}));

import {
  PersonalPlaylistProvider,
  usePersonalPlaylist,
} from "./usePersonalPlaylist";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let retryFromContext:
  | ((episodeId: string, title: string) => Promise<void>)
  | undefined;

const Probe = () => {
  const retry = usePersonalPlaylist().retry;
  useEffect(() => {
    retryFromContext = retry;
  }, [retry]);
  return null;
};

describe("PersonalPlaylistProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.retryEpisode.mockReset();
    retryFromContext = undefined;
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
});
