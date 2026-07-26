// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArticleAudioExportProvider,
  useArticleAudioExports,
} from "./ArticleAudioExportProvider";
import { AuthAwareTtsProfileProvider } from "@/lib/tts-audience";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: false as boolean | undefined,
  },
  convexAuth: {
    isLoading: false,
    isAuthenticated: false,
  },
  startExport: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.convexAuth,
  useMutation: () => mocks.startExport,
  useQuery: () => [],
}));

type ExportContext = ReturnType<typeof useArticleAudioExports>;
let latest: ExportContext | null = null;

const ContextProbe = () => {
  const value = useArticleAudioExports();

  useEffect(() => {
    latest = value;
  }, [value]);

  return null;
};

const Harness = () => (
  <AuthAwareTtsProfileProvider>
    <ArticleAudioExportProvider>
      <ContextProbe />
    </ArticleAudioExportProvider>
  </AuthAwareTtsProfileProvider>
);

const context = (): ExportContext => {
  if (!latest) throw new Error("Export context has not rendered.");
  return latest;
};

describe("ArticleAudioExportProvider auth bridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.auth.isLoaded = true;
    mocks.auth.isSignedIn = false;
    mocks.convexAuth.isLoading = false;
    mocks.convexAuth.isAuthenticated = false;
    mocks.startExport.mockResolvedValue({
      exportId: "export-1",
      status: "queued",
      ttsProvider: "edge",
    });
    window.localStorage.setItem(
      "cg-article-audio-export-client-id",
      "client-1",
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    latest = null;
    window.localStorage.clear();
    container.remove();
  });

  it("pins a resolved guest export to Edge", async () => {
    await act(async () => {
      await context().queueExport({
        articleId: "article-1",
        title: "The Shire",
      });
    });

    expect(mocks.startExport).toHaveBeenCalledWith({
      clientId: "client-1",
      articleId: "article-1",
      expectedTtsProvider: "edge",
    });
  });

  it("waits for Clerk before deciding whether an export is public", async () => {
    mocks.auth.isLoaded = false;
    mocks.auth.isSignedIn = undefined;
    await act(async () => {
      root.render(<Harness />);
    });

    await expect(
      context().queueExport({ articleId: "article-1", title: "Rivendell" }),
    ).rejects.toThrow("still connecting");
    expect(mocks.startExport).not.toHaveBeenCalled();
  });

  it("waits instead of queuing a guest export during the signed-in auth bridge", async () => {
    mocks.auth.isSignedIn = true;
    mocks.convexAuth.isLoading = true;
    await act(async () => {
      root.render(<Harness />);
    });

    await expect(
      context().queueExport({ articleId: "article-1", title: "Moria" }),
    ).rejects.toThrow("still connecting");
    expect(mocks.startExport).not.toHaveBeenCalled();
  });

  it("falls back to an Edge export after the Convex auth bridge fails", async () => {
    mocks.auth.isSignedIn = true;
    mocks.convexAuth.isLoading = false;
    mocks.convexAuth.isAuthenticated = false;
    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      await context().queueExport({
        articleId: "article-1",
        title: "The Prancing Pony",
      });
    });

    expect(mocks.startExport).toHaveBeenCalledWith({
      clientId: "client-1",
      articleId: "article-1",
      expectedTtsProvider: "edge",
    });
  });

  it("pins a fully authenticated export to the active OpenAI provider", async () => {
    mocks.auth.isSignedIn = true;
    mocks.convexAuth.isAuthenticated = true;
    mocks.startExport.mockResolvedValue({
      exportId: "export-openai",
      status: "queued",
      ttsProvider: "openai",
    });
    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      await context().queueExport({
        articleId: "article-1",
        title: "Lothlórien",
      });
    });

    expect(mocks.startExport).toHaveBeenCalledWith({
      clientId: "client-1",
      articleId: "article-1",
      expectedTtsProvider: "openai",
    });
  });

  it("rejects a job when the server resolves a different voice provider", async () => {
    mocks.auth.isSignedIn = true;
    mocks.convexAuth.isAuthenticated = true;
    mocks.startExport.mockResolvedValue({
      exportId: "export-edge",
      status: "queued",
      ttsProvider: "edge",
    });
    await act(async () => {
      root.render(<Harness />);
    });

    let receivedError: unknown;
    await act(async () => {
      try {
        await context().queueExport({
          articleId: "article-1",
          title: "The Two Trees",
        });
      } catch (error) {
        receivedError = error;
      }
    });

    expect(receivedError).toEqual(
      new Error("Article audio voice changed. Please try the export again."),
    );
  });
});
