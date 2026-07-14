// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArticleContextRequest,
  ContextManifest,
} from "@/lib/article-context-types";
import { useArticleContext } from "./useArticleContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const waitForExpectation = async (assertion: () => void) => {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await Promise.resolve();
      });
      assertion();
    },
    { interval: 1, timeout: 1_000 },
  );
};

const response = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as Response;

const request = (
  id: string,
  overrides: Partial<ArticleContextRequest> = {},
): ArticleContextRequest => ({
  wikiPageId: id,
  title: `Article ${id}`,
  revisionId: `${id}00`,
  language: "en",
  ...overrides,
});

const manifest = (
  id: string,
  overrides: Partial<ContextManifest> = {},
): ContextManifest => ({
  schemaVersion: 2,
  wikiPageId: id,
  title: `Article ${id}`,
  revisionId: `${id}00`,
  language: "en",
  sourceHash: `hash-${id}`,
  extractorVersion: "2.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [],
  ...overrides,
});

const Probe = ({ value }: { value: ArticleContextRequest | null }) => {
  const state = useArticleContext(value);
  return (
    <div>
      <output data-status={state.status}>
        {state.manifest
          ? `${state.manifest.title}:${state.manifest.blocks
              .map((block) => block.id)
              .join(",")}`
          : state.error ?? ""}
      </output>
      <button type="button" onClick={state.retry}>
        Retry
      </button>
    </div>
  );
};

describe("useArticleContext", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts the prior key and never exposes its late completion", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const calls: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      calls.push(init?.signal as AbortSignal);
      if (calls.length === 1) return first.promise;
      if (calls.length === 2) return second.promise;
      return third.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Probe value={request("1")} />));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(calls[0].aborted).toBe(false);

    await act(async () => root.render(<Probe value={request("2")} />));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(calls[0].aborted).toBe(true);
    const output = container.querySelector("output")!;
    expect(output.dataset.status).toBe("loading");
    expect(output.textContent).not.toContain("Article 1");

    await act(async () => {
      second.resolve(response({ context: manifest("2"), cacheStatus: "miss" }));
    });
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("ready");
      expect(output.textContent).toBe("Article 2:");
    });

    await act(async () => {
      first.resolve(response({ context: manifest("1"), cacheStatus: "miss" }));
    });
    expect(output.dataset.status).toBe("ready");
    expect(output.textContent).toBe("Article 2:");

    await act(async () => root.render(<Probe value={null} />));
    expect(calls[1].aborted).toBe(true);
    expect(output.dataset.status).toBe("idle");
    expect(output.textContent).toBe("");

    await act(async () => root.render(<Probe value={request("2")} />));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(output.dataset.status).toBe("loading");
    expect(output.textContent).toBe("");
    await act(async () => {
      third.resolve(response({ context: manifest("2"), cacheStatus: "hit" }));
    });
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("ready");
      expect(output.textContent).toBe("Article 2:");
    });
  });

  it("aborts on unmount without publishing a late response", async () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal as AbortSignal;
        return pending.promise;
      }),
    );

    await act(async () => root.render(<Probe value={request("1")} />));
    await waitForExpectation(() => expect(signal).toBeDefined());
    act(() => root.unmount());
    mounted = false;
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(response({ context: manifest("1"), cacheStatus: "miss" }));
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("retries from loading with a fresh abortable request", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Probe value={request("retry")} />));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve(response({ error: "Context failed." }, false));
    });
    const output = container.querySelector("output")!;
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("error");
      expect(output.textContent).toBe("Context failed.");
    });

    act(() => {
      container.querySelector("button")!.click();
    });
    expect(output.dataset.status).toBe("loading");
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      second.resolve(
        response({ context: manifest("retry"), cacheStatus: "miss" }),
      );
    });
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("ready");
      expect(output.textContent).toBe("Article retry:");
    });
  });

  it("uses the full request identity without refetching equivalent values", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as ArticleContextRequest;
      return response({
        context: manifest(body.wikiPageId, {
          title: body.title,
          revisionId: body.revisionId,
          language: body.language ?? "en",
        }),
        cacheStatus: "miss",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const base = request("identity");

    await act(async () => root.render(<Probe value={base} />));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<Probe value={{ ...base }} />));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(<Probe value={{ ...base, title: "Renamed article" }} />),
    );
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () =>
      root.render(<Probe value={{ ...base, revisionId: "new-revision" }} />),
    );
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await act(async () =>
      root.render(<Probe value={{ ...base, language: "fr" }} />),
    );
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("sorts blocks deterministically and rejects legacy schema responses", async () => {
    const unsortedBlocks = [
      { id: "zeta", title: "Zeta", order: 2 },
      { id: "beta", title: "Beta", order: 1 },
      { id: "alpha", title: "Alpha", order: 1 },
    ] as unknown as ContextManifest["blocks"];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          context: manifest("sorted", { blocks: unsortedBlocks }),
          cacheStatus: "hit",
        }),
      )
      .mockResolvedValueOnce(
        response({
          context: { ...manifest("legacy"), schemaVersion: 1 },
          cacheStatus: "hit",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Probe value={request("sorted")} />));
    const output = container.querySelector("output")!;
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("ready");
      expect(output.textContent).toBe("Article sorted:alpha,beta,zeta");
    });

    await act(async () => root.render(<Probe value={request("legacy")} />));
    await waitForExpectation(() => {
      expect(output.dataset.status).toBe("error");
      expect(output.textContent).toBe(
        "Visual context returned an unexpected response.",
      );
    });
  });
});
