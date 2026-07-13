// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAdaptiveImage } from "@/lib/adaptive-image";
import { AdaptiveImageFrame } from "./AdaptiveImageFrame";

vi.mock("@/lib/adaptive-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adaptive-image")>();
  return {
    ...actual,
    analyzeAdaptiveImage: vi.fn(async (url: string) => ({
      url,
      hasTransparency: false,
    })),
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AdaptiveImageFrame", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frameRect: { width: number; height: number };

  beforeEach(() => {
    vi.mocked(analyzeAdaptiveImage).mockReset();
    vi.mocked(analyzeAdaptiveImage).mockImplementation(async (url) => ({
      url,
      hasTransparency: false,
    }));
    frameRect = { width: 160, height: 90 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: frameRect.width,
          bottom: frameRect.height,
          width: frameRect.width,
          height: frameRect.height,
          toJSON: () => ({}),
        }) as DOMRect,
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

  it("re-evaluates crop retention when ResizeObserver reports a new frame", async () => {
    let triggerResize: (() => void) | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        triggerResize = () =>
          callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/landscape.jpg"
          alt="Mountain landscape"
          width={1600}
          height={900}
          sizes="100vw"
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      "[data-adaptive-image-frame]",
    )!;
    expect(frame.dataset.adaptiveImageMode).toBe("cover");

    frameRect = { width: 1000, height: 100 };
    await act(async () => triggerResize?.());

    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
    expect(frame.dataset.adaptiveImageReason).toBe("crop");
  });

  it("uses window resize as a safe fallback without ResizeObserver", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/landscape.jpg"
          alt="Mountain landscape"
          width={1600}
          height={900}
          sizes="100vw"
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      "[data-adaptive-image-frame]",
    )!;
    expect(frame.dataset.adaptiveImageMode).toBe("cover");

    frameRect = { width: 1000, height: 100 };
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
  });

  it("keeps an ordinary landscape full-bleed in a wide article hero", async () => {
    frameRect = { width: 800, height: 256 };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );

    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/article-hero.jpg"
          alt="Article hero"
          width={1600}
          height={900}
          sizes="100vw"
          backdropImageClassName="md:pb-24"
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      "[data-adaptive-image-frame]",
    )!;
    expect(frame.dataset.adaptiveImageMode).toBe("cover");
    expect(frame.dataset.adaptiveImageReason).toBe("cover");
    expect(
      container.querySelector<HTMLImageElement>('img[alt="Article hero"]')
        ?.className,
    ).toContain("object-cover");
    expect(
      container.querySelector<HTMLImageElement>('img[alt="Article hero"]')
        ?.className,
    ).not.toContain("md:pb-24");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("fills the frame with an ordinary portrait and favors its upper subject", async () => {
    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/portrait.jpg"
          alt="Portrait of a botanist"
          width={900}
          height={1200}
          sizes="320px"
        />,
      );
    });

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe("Portrait of a botanist");
    expect(images[0].className).toContain("object-cover");
    expect(images[0].className).toContain("object-[50%_30%]");
  });

  it("exposes one meaningful image and hides the copy for extreme media", async () => {
    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/extreme-portrait.jpg"
          alt="A very tall historical scroll"
          width={320}
          height={1600}
          sizes="320px"
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      "[data-adaptive-image-frame]",
    )!;
    const images = Array.from(container.querySelectorAll("img"));
    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
    expect(frame.dataset.adaptiveImageReason).toBe("extreme-aspect");
    expect(images).toHaveLength(2);
    expect(images[0].alt).toBe("");
    expect(images[0].getAttribute("aria-hidden")).toBe("true");
    expect(images[1].alt).toBe("A very tall historical scroll");
    expect(images[1].className).toContain("object-contain");
    expect(images[1].className).not.toContain("p-1.5");
  });

  it("preserves transparent media on its analyzed panel", async () => {
    vi.mocked(analyzeAdaptiveImage).mockResolvedValueOnce({
      url: "https://upload.wikimedia.org/transparent.png",
      hasTransparency: true,
      panelBackground: "rgb(10, 20, 30)",
      panelBorderColor: "rgb(40, 50, 60)",
    });

    await act(async () => {
      root.render(
        <AdaptiveImageFrame
          src="https://upload.wikimedia.org/transparent.png"
          alt="Transparent botanical illustration"
          width={1600}
          height={900}
          sizes="320px"
          backdropImageClassName="md:pb-24"
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      "[data-adaptive-image-frame]",
    )!;
    const images = Array.from(container.querySelectorAll("img"));
    const analyzedPanel = Array.from(container.querySelectorAll("span")).find(
      (element) => element.style.background === "rgb(10, 20, 30)",
    );
    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
    expect(frame.dataset.adaptiveImageReason).toBe("transparent");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("aria-hidden")).toBe("true");
    expect(images[1].alt).toBe("Transparent botanical illustration");
    expect(images[1].className).toContain("object-contain");
    expect(images[1].className).toContain("p-1.5");
    expect(images[1].className).toContain("md:pb-24");
    expect(analyzedPanel).toBeTruthy();
  });
});
