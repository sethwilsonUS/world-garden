// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArticleContextRequest,
  ContextManifest,
} from "@/lib/article-context-types";
import { useArticleContext } from "./ArticleContext";

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

const response = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as Response;

const request = (id: string): ArticleContextRequest => ({
  wikiPageId: id,
  title: `Article ${id}`,
  revisionId: `${id}00`,
  language: "en",
});

const manifest = (id: string): ContextManifest => ({
  schemaVersion: 2,
  wikiPageId: id,
  title: `Article ${id}`,
  revisionId: `${id}00`,
  language: "en",
  sourceHash: `hash-${id}`,
  extractorVersion: "2.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [],
});

const Probe = ({ value }: { value: ArticleContextRequest | null }) => {
  const state = useArticleContext(value);
  return (
    <output data-status={state.status}>
      {state.manifest?.title ?? state.error ?? ""}
    </output>
  );
};

describe("useArticleContext request identity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not expose ready or error state from a previous request key", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const fourth = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise)
        .mockReturnValueOnce(fourth.promise),
    );

    await act(async () => {
      root.render(<Probe value={request("1")} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("loading");

    await act(async () => {
      first.resolve(response({ context: manifest("1"), cacheStatus: "miss" }));
      await first.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("ready");
    expect(container.textContent).toBe("Article 1");

    await act(async () => {
      root.render(<Probe value={request("2")} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("loading");
    expect(container.textContent).not.toContain("Article 1");

    await act(async () => {
      second.resolve(response({ error: "Context failed." }, false));
      await second.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("error");
    expect(container.textContent).toBe("Context failed.");

    await act(async () => {
      root.render(<Probe value={request("3")} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("loading");
    expect(container.textContent).not.toContain("Context failed.");

    await act(async () => {
      root.render(<Probe value={null} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("idle");
    expect(container.textContent).toBe("");

    await act(async () => {
      root.render(<Probe value={request("1")} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.status).toBe("loading");
    expect(container.textContent).not.toContain("Article 1");
  });

  it("rejects a legacy schema-v1 response instead of exposing stale context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          context: { ...manifest("legacy"), schemaVersion: 1 },
          cacheStatus: "hit",
        }),
      ),
    );

    await act(async () => {
      root.render(<Probe value={request("legacy")} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.dataset.status).toBe("error");
    expect(container.textContent).toBe(
      "Visual context returned an unexpected response.",
    );
  });
});
