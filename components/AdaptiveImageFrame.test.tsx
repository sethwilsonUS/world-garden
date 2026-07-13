// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    frameRect = { width: 100, height: 100 };
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

    frameRect = { width: 100, height: 100 };
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
  });

  it("uses the measured wide article-hero frame instead of a 16:9 assumption", async () => {
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
    expect(frame.dataset.adaptiveImageMode).toBe("backdrop");
    expect(frame.dataset.adaptiveImageReason).toBe("crop");
    expect(
      container.querySelector<HTMLImageElement>('img[alt="Article hero"]')
        ?.className,
    ).toContain("md:pb-24");
  });

  it("exposes one meaningful image and hides its blurred portrait copy", async () => {
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
    expect(images).toHaveLength(2);
    expect(images.filter((image) => image.alt === "Portrait of a botanist"))
      .toHaveLength(1);
    expect(images[0].getAttribute("alt")).toBe("");
    expect(images[0].getAttribute("aria-hidden")).toBe("true");
    expect(images[1].className).toContain("object-contain");
  });
});
