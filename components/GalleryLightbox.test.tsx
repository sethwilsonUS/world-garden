// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleImage } from "@/lib/data-context";
import { GalleryLightbox, type LightboxState } from "./GalleryLightbox";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const images: ArticleImage[] = [
  {
    src: "https://upload.wikimedia.org/poster.jpg",
    originalSrc: "https://upload.wikimedia.org/poster.jpg",
    videoSrc: "https://upload.wikimedia.org/video.webm",
    alt: "A demonstration video",
    caption: "A demonstration.",
  },
  {
    src: "https://upload.wikimedia.org/330px-example.jpg",
    lightboxSrc: "https://upload.wikimedia.org/1600px-example.jpg",
    alt: "A detailed example",
    caption: "The detailed example.",
  },
];

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

const touch = (
  target: Element,
  type: "touchstart" | "touchend",
  point: { clientX: number; clientY: number },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === "touchstart" ? "touches" : "changedTouches", {
    value: [point],
  });
  target.dispatchEvent(event);
};

const Harness = ({ galleryImages }: { galleryImages: ArticleImage[] }) => {
  const [state, setState] = useState<LightboxState>(null);
  return (
    <>
      <button
        type="button"
        onClick={(event) => setState({ index: 0, opener: event.currentTarget })}
      >
        Open gallery
      </button>
      {state ? (
        <GalleryLightbox
          images={galleryImages}
          state={state}
          onClose={() => setState(null)}
        />
      ) : null}
    </>
  );
};

describe("GalleryLightbox", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let showModalDescriptor: PropertyDescriptor | undefined;
  let closeDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    showModalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "showModal",
    );
    closeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "close",
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      }),
    });
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    document.body.style.overflow = "";
    container.remove();
    vi.restoreAllMocks();
    if (showModalDescriptor) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "showModal",
        showModalDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    }
    if (closeDescriptor) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "close",
        closeDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("does not autoplay gallery video", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryLightbox, {
        images: [images[0]],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain('preload="metadata"');
    expect(markup).not.toContain("autoplay");
  });

  it("renders the preferred rendition with accessible dialog semantics", () => {
    const image = {
      ...images[1],
      lightboxWidth: 1600,
      lightboxHeight: 1200,
      width: 330,
      height: 248,
    } satisfies ArticleImage;
    const markup = renderToStaticMarkup(
      createElement(GalleryLightbox, {
        images: [image],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain("https://upload.wikimedia.org/1600px-example.jpg");
    expect(markup).toContain("data-lightbox-media-stage");
    expect(markup).toContain('aria-labelledby="');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('alt="A detailed example"');
    expect(markup).toContain("h-11 w-11");
    expect(markup).toContain("position:absolute");
    expect(markup).not.toContain('width="330"');
  });

  it("does not repeat a visible caption as the image alternative", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryLightbox, {
        images: [
          {
            src: "https://upload.wikimedia.org/portrait.jpg",
            alt: "Portrait of Ada Lovelace",
            caption: "Portrait of Ada Lovelace",
          },
        ],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain('alt=""');
    expect(markup).toContain(">Portrait of Ada Lovelace</p>");
  });

  it("uses the thumbnail when no trusted lightbox rendition exists", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryLightbox, {
        images: [
          {
            src: "https://upload.wikimedia.org/330px-example.jpg",
            originalSrc:
              "https://upload.wikimedia.org/guessed-original-example.jpg",
            alt: "A cached example",
            caption: "An image from a legacy cache row.",
          },
        ],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain("https://upload.wikimedia.org/330px-example.jpg");
    expect(markup).not.toContain(
      "https://upload.wikimedia.org/guessed-original-example.jpg",
    );
  });

  it("moves focus in and restores it after cancel", async () => {
    document.body.style.overflow = "auto";
    await act(async () => root.render(<Harness galleryImages={images} />));
    const opener = container.querySelector("button")!;
    opener.focus();
    act(() => opener.click());

    await waitForExpectation(() =>
      expect(container.querySelector('[aria-label="Close lightbox"]')).toBe(
        document.activeElement,
      ),
    );
    expect(document.body.style.overflow).toBe("hidden");
    const dialog = container.querySelector("dialog")!;
    act(() => {
      dialog.dispatchEvent(
        new Event("cancel", { bubbles: true, cancelable: true }),
      );
    });

    await waitForExpectation(() =>
      expect(container.querySelector("dialog")).toBeNull(),
    );
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("follows a new requested index without remounting the dialog", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <GalleryLightbox
          images={images}
          state={{ index: 0 }}
          onClose={onClose}
        />,
      ),
    );
    const dialog = container.querySelector("dialog")!;
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
      "image 1 of 2",
    );

    await act(async () =>
      root.render(
        <GalleryLightbox
          images={images}
          state={{ index: 1 }}
          onClose={onClose}
        />,
      ),
    );

    expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
      "image 2 of 2",
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("wraps keyboard and swipe navigation while excluding interactive targets", async () => {
    await act(async () => root.render(<Harness galleryImages={images} />));
    act(() => container.querySelector("button")!.click());
    await waitForExpectation(() =>
      expect(container.querySelector("dialog")).not.toBeNull(),
    );
    const dialog = container.querySelector("dialog")!;
    const status = dialog.querySelector('[role="status"]')!;
    const video = dialog.querySelector("video")!;

    act(() => {
      video.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(status.textContent).toContain("image 1 of 2");

    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    await waitForExpectation(() =>
      expect(status.textContent).toContain("image 2 of 2"),
    );

    const input = document.createElement("input");
    dialog.querySelector("[data-lightbox-media-stage]")!.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      touch(input, "touchstart", { clientX: 500, clientY: 200 });
      touch(input, "touchend", { clientX: 300, clientY: 200 });
    });
    expect(status.textContent).toContain("image 2 of 2");

    const stage = dialog.querySelector("[data-lightbox-media-stage]")!;
    act(() => {
      touch(stage, "touchstart", { clientX: 500, clientY: 200 });
      touch(stage, "touchend", { clientX: 300, clientY: 205 });
    });
    await waitForExpectation(() =>
      expect(status.textContent).toContain("image 1 of 2"),
    );
  });

  it("falls back once, then reports total image failure without duplicate status", async () => {
    await act(async () =>
      root.render(
        <GalleryLightbox
          images={[images[1]]}
          state={{ index: 0 }}
          onClose={() => {}}
        />,
      ),
    );
    const dialog = container.querySelector("dialog")!;
    const preferred = dialog.querySelector("img")!;
    expect(preferred.getAttribute("src")).toContain("1600px-example.jpg");

    act(() => preferred.dispatchEvent(new Event("error")));
    await waitForExpectation(() => {
      expect(dialog.querySelector("img")?.getAttribute("src")).toContain(
        "330px-example.jpg",
      );
      expect(dialog.textContent).toContain(
        "The larger image was unavailable, so the gallery thumbnail is shown.",
      );
    });

    act(() =>
      dialog.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    await waitForExpectation(() => {
      expect(dialog.textContent).toContain("This image could not be loaded.");
      expect(dialog.textContent).not.toContain(
        "The larger image was unavailable, so the gallery thumbnail is shown.",
      );
    });
    expect(
      Array.from(dialog.querySelectorAll('[role="status"]')).filter(
        (node) => node.textContent === "This image could not be loaded.",
      ),
    ).toHaveLength(0);
  });
});
