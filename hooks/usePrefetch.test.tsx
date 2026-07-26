// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataContext, type DataContextValue } from "@/lib/data-context";
import { PublicTtsProfileProvider } from "@/lib/tts-audience";
import { usePrefetch } from "./usePrefetch";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const Harness = () => {
  const prefetch = usePrefetch();

  useEffect(() => {
    prefetch("The Silmarillion");
  }, [prefetch]);

  return null;
};

describe("usePrefetch", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:edge-summary");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("audio", {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        }),
      ),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("warms guest summary audio with an explicit Edge request", async () => {
    const fetchArticle = vi.fn().mockResolvedValue({
      summary: "The Silmarillion recounts the elder history of Middle-earth.",
    });
    const data = { fetchArticle } as unknown as DataContextValue;

    await act(async () => {
      root.render(
        <PublicTtsProfileProvider>
          <DataContext.Provider value={data}>
            <Harness />
          </DataContext.Provider>
        </PublicTtsProfileProvider>,
      );
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ provider: "edge" });
  });
});
