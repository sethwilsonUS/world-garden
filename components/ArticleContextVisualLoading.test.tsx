// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContextChartBlock,
  ContextDiagramBlock,
  ContextMapBlock,
} from "@/lib/article-context-types";
import {
  ContextChartView,
  ContextDiagramView,
  ContextMapView,
} from "./ArticleContextVisuals";
import { ArticleContextLane } from "./ArticleContext";
import { ThemeProvider } from "./ThemeProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const echartsMock = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const chart = {
    dispose: vi.fn(),
    off: vi.fn((name: string, callback: () => void) => {
      if (handlers.get(name) === callback) handlers.delete(name);
    }),
    on: vi.fn((name: string, callback: () => void) => {
      handlers.set(name, callback);
    }),
    resize: vi.fn(),
    setOption: vi.fn(),
  };
  return {
    chart,
    handlers,
    init: vi.fn(() => chart),
  };
});

vi.mock("echarts", () => ({ init: echartsMock.init }));

const maplibreMock = vi.hoisted(() => {
  const onceHandlers = new Map<string, () => void>();
  const eventHandlers = new Map<string, (event: unknown) => void>();
  const canvas = document.createElement("canvas");
  const instance = {
    addLayer: vi.fn(),
    addSource: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    getZoom: vi.fn(() => 5),
    jumpTo: vi.fn(),
    on: vi.fn((name: string, callback: (event: unknown) => void) => {
      eventHandlers.set(name, callback);
    }),
    once: vi.fn((name: string, callback: () => void) => {
      onceHandlers.set(name, callback);
    }),
    panBy: vi.fn(),
    remove: vi.fn(),
    triggerRepaint: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
  const MapConstructor = vi.fn(function MapConstructor(options: {
    container: HTMLElement;
  }) {
    options.container.appendChild(canvas);
    canvas.tabIndex = 0;
    return instance;
  });
  return { MapConstructor, canvas, eventHandlers, instance, onceHandlers };
});

vi.mock("maplibre-gl", () => ({ Map: maplibreMock.MapConstructor }));

const chartBlock: ContextChartBlock = {
  id: "population-chart",
  kind: "chart",
  title: "Population over time",
  caption: "Population rises across the three source years.",
  longDescription: "Population rises from 100 to 140.",
  section: { index: "1", title: "Population" },
  order: 0,
  sources: [],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "chart-source",
    extractorVersion: "test",
    descriptionMethod: "deterministic",
  },
  chart: {
    columns: [
      { key: "year", label: "Year", dataType: "string" },
      { key: "population", label: "Population", dataType: "number" },
    ],
    rows: [
      { year: "2022", population: 100 },
      { year: "2023", population: 120 },
      { year: "2024", population: 140 },
    ],
    series: [
      {
        id: "population",
        label: "Population",
        type: "line",
        xColumn: "year",
        yColumn: "population",
      },
    ],
    sourceChartType: "wikitable",
  },
};

const multiSeriesChartBlock: ContextChartBlock = {
  ...chartBlock,
  chart: {
    ...chartBlock.chart,
    columns: [
      ...chartBlock.chart.columns,
      { key: "projection", label: "Projection", dataType: "number" },
    ],
    rows: chartBlock.chart.rows.map((row, index) => ({
      ...row,
      projection: 110 + index * 20,
    })),
    series: [
      ...chartBlock.chart.series,
      {
        id: "projection",
        label: "Projection",
        type: "line",
        xColumn: "year",
        yColumn: "projection",
      },
    ],
  },
};

const mapBlock: ContextMapBlock = {
  id: "journey-map",
  kind: "map",
  title: "Journey through Italy",
  caption: "Places on the journey.",
  longDescription: "The route connects Florence and Rome.",
  section: { index: "2", title: "Journey" },
  order: 1,
  sources: [],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "map-source",
    extractorVersion: "test",
    descriptionMethod: "deterministic",
  },
  map: {
    center: { latitude: 42.4, longitude: 12.5 },
    suggestedZoom: 5,
    places: [
      {
        id: "florence",
        name: "Florence",
        latitude: 43.7696,
        longitude: 11.2558,
      },
      { id: "rome", name: "Rome", latitude: 41.9028, longitude: 12.4964 },
    ],
    routes: [],
    areas: [],
  },
};

const diagramBlock: ContextDiagramBlock = {
  id: "system-diagram",
  kind: "diagram",
  title: "How the system connects",
  caption: "The first part flows into the second part.",
  longDescription:
    "A labeled diagram showing the complete system relationship.",
  section: { index: "3", title: "System" },
  order: 2,
  sources: [],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "diagram-source",
    extractorVersion: "test",
    descriptionMethod: "deterministic",
  },
  diagram: {
    image: {
      src: "https://upload.wikimedia.org/example.png",
      alt: "Two labeled parts connected by an arrow.",
      width: 800,
      height: 600,
    },
    parts: [
      { id: "input", label: "First part", description: "The input." },
      { id: "output", label: "Second part", description: "The output." },
    ],
    relationships: [{ fromId: "input", toId: "output", label: "flows into" }],
    walkthrough: [
      "Begin at the first part.",
      "Follow the arrow to the second part.",
    ],
    caption: "The source diagram.",
  },
};

describe("article context rich visual loading", () => {
  let container: HTMLDivElement;
  let root: Root;
  let intersectionCallback:
    | ((entries: Array<{ isIntersecting: boolean }>) => void)
    | undefined;

  beforeEach(() => {
    intersectionCallback = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    echartsMock.handlers.clear();
    echartsMock.init.mockReset();
    echartsMock.init.mockImplementation(() => echartsMock.chart);
    echartsMock.chart.setOption.mockClear();
    maplibreMock.onceHandlers.clear();
    maplibreMock.eventHandlers.clear();
    maplibreMock.canvas.remove();
    maplibreMock.MapConstructor.mockClear();
    Object.values(maplibreMock.instance).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value)
        value.mockClear();
    });
    document.documentElement.className = "light";

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.assign(globalThis, {
      IntersectionObserver: class {
        constructor(
          callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        ) {
          intersectionCallback = callback;
        }
        disconnect() {}
        observe() {}
      },
      ResizeObserver: class {
        disconnect() {}
        observe() {}
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document
      .querySelectorAll("[data-visual-loading-test-outside]")
      .forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it("keeps the manifest loading status outside the busy content subtree", async () => {
    await act(async () => {
      root.render(
        <ArticleContextLane
          state={{ status: "loading", manifest: null, error: null }}
          retry={() => {}}
        />,
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.closest('[aria-busy="true"]')).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("marks a chart ready only after ECharts finishes its first render", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextChartView
            block={chartBlock}
            caption={chartBlock.caption}
            captionId="population-caption"
          />
        </ThemeProvider>,
      );
    });

    expect(
      container.querySelector('[data-visual-state="deferred"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-echarts")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(echartsMock.init).not.toHaveBeenCalled();

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(echartsMock.init).toHaveBeenCalledOnce());

    expect(echartsMock.chart.setOption).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-visual-state="loading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-echarts")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(container.querySelectorAll(".context-visual-spinner")).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll('.context-visual-load-status[role="status"]'),
    ).toHaveLength(1);
    expect(
      container
        .querySelector('.context-visual-load-status[role="status"]')
        ?.closest('[aria-busy="true"]'),
    ).toBeNull();

    await act(async () => {
      echartsMock.handlers.get("finished")?.();
    });

    expect(
      container.querySelector('[data-visual-state="ready"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-echarts")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector(".context-rich-media-placeholder"),
    ).toBeNull();
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(
      container.querySelectorAll('.context-visual-load-status[role="status"]'),
    ).toHaveLength(1);
  });

  it("keeps a narrow horizontal chart deferred and silent until it nears the viewport", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("max-width"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const narrowChart: ContextChartBlock = {
      ...chartBlock,
      chart: {
        ...chartBlock.chart,
        rows: Array.from({ length: 9 }, (_, index) => ({
          year: `Category ${index + 1}`,
          population: 100 + index,
        })),
        series: [
          {
            ...chartBlock.chart.series[0],
            type: "bar",
          },
        ],
      },
    };

    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextChartView
            block={narrowChart}
            caption={narrowChart.caption}
            captionId="narrow-chart-caption"
          />
        </ThemeProvider>,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-visual-state="deferred"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.context-visual-load-status[role="status"]'),
    ).toBeNull();
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(echartsMock.init).not.toHaveBeenCalled();
  });

  it("keeps chart selection controls unavailable until the active visual is ready", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextChartView
            block={multiSeriesChartBlock}
            caption={multiSeriesChartBlock.caption}
            captionId="population-caption"
          />
        </ThemeProvider>,
      );
    });

    const controls = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        ".context-standard-chart-controls input",
      ),
    );
    expect(controls).toHaveLength(2);
    expect(controls.every((control) => control.disabled)).toBe(true);

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(echartsMock.init).toHaveBeenCalledOnce());
    expect(controls.every((control) => control.disabled)).toBe(true);

    await act(async () => {
      echartsMock.handlers.get("finished")?.();
    });
    expect(controls.every((control) => control.disabled)).toBe(false);
  });

  it("replaces a failed rich chart with the deterministic chart and stops loading", async () => {
    echartsMock.init.mockImplementationOnce(() => {
      throw new Error("WebGL has left the building");
    });

    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextChartView
            block={chartBlock}
            caption={chartBlock.caption}
            captionId="population-caption"
          />
        </ThemeProvider>,
      );
    });

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-visual-state="fallback"]'),
      ).not.toBeNull(),
    );

    expect(
      container.querySelector(".context-echarts")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector(".context-echarts-fallback svg"),
    ).not.toBeNull();
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(container.textContent).toContain("Interactive chart unavailable");
    expect(container.textContent).toContain("Exact chart data");
  });

  it("keeps map controls disabled until MapLibre paints its first frame", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextMapView
            block={mapBlock}
            caption={mapBlock.caption}
            captionId="journey-caption"
            descriptionId="journey-description"
          />
        </ThemeProvider>,
      );
    });

    expect(
      container.querySelector('[data-visual-state="deferred"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-map-canvas")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelectorAll(".context-map-toolbar button:disabled"),
    ).toHaveLength(7);
    expect(container.querySelector(".context-visual-spinner")).toBeNull();

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(maplibreMock.MapConstructor).toHaveBeenCalledOnce(),
    );

    expect(
      container.querySelector('[data-visual-state="loading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-map-canvas")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(container.querySelectorAll(".context-visual-spinner")).toHaveLength(
      1,
    );
    expect(maplibreMock.canvas.tabIndex).toBe(-1);
    expect(maplibreMock.canvas.getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      container.querySelector('[role="status"]')?.closest('[aria-busy="true"]'),
    ).toBeNull();

    await act(async () => {
      maplibreMock.onceHandlers.get("load")?.();
    });

    expect(
      container.querySelector('[data-visual-state="loading"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".context-map-toolbar button:disabled"),
    ).toHaveLength(7);
    expect(maplibreMock.instance.triggerRepaint).toHaveBeenCalledOnce();

    await act(async () => {
      maplibreMock.onceHandlers.get("render")?.();
    });

    expect(
      container.querySelector('[data-visual-state="ready"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-map-canvas")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector(".context-map-toolbar button:disabled"),
    ).toBeNull();
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(maplibreMock.canvas.tabIndex).toBe(0);
    expect(maplibreMock.canvas.hasAttribute("aria-disabled")).toBe(false);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".context-map-place-controls button")
        ?.click();
    });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Centered map on Florence",
    );

    await act(async () => {
      maplibreMock.eventHandlers.get("error")?.({
        error: { url: "https://tiles.openfreemap.org/tiles/5/1/2.pbf" },
        tile: {},
      });
    });
    expect(
      container.querySelector('[data-visual-state="error"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-map-canvas")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector(".context-map-toolbar button:disabled"),
    ).toBeNull();
    expect(container.textContent).toContain("Some map details could not load");
  });

  it("does not move outside focus when a map load fails", async () => {
    const outsideButton = document.createElement("button");
    outsideButton.dataset.visualLoadingTestOutside = "true";
    outsideButton.textContent = "Outside action";
    document.body.prepend(outsideButton);

    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextMapView
            block={mapBlock}
            caption={mapBlock.caption}
            captionId="journey-caption"
            descriptionId="journey-description"
          />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(maplibreMock.MapConstructor).toHaveBeenCalledOnce(),
    );
    outsideButton.focus();

    await act(async () => {
      maplibreMock.eventHandlers.get("error")?.({
        error: { url: "https://tiles.openfreemap.org/styles/liberty" },
      });
    });

    expect(document.activeElement).toBe(outsideButton);
    expect(
      container.querySelector('[data-visual-state="fallback"]'),
    ).not.toBeNull();
  });

  it("replaces a fatal map load with its coordinate overview and a retry", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ContextMapView
            block={mapBlock}
            caption={mapBlock.caption}
            captionId="journey-caption"
            descriptionId="journey-description"
          />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(maplibreMock.MapConstructor).toHaveBeenCalledOnce(),
    );
    maplibreMock.canvas.focus();
    expect(document.activeElement).toBe(maplibreMock.canvas);

    await act(async () => {
      maplibreMock.eventHandlers.get("error")?.({
        error: { url: "https://tiles.openfreemap.org/styles/liberty" },
      });
    });

    expect(
      container.querySelector('[data-visual-state="fallback"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".context-map-schematic svg"),
    ).not.toBeNull();
    expect(container.querySelector(".context-map-surface")).toBeNull();
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(container.textContent).toContain("Retry interactive street map");
    expect(container.textContent).toContain("Exact map data");
    expect(document.activeElement?.textContent).toContain(
      "Retry interactive street map",
    );
  });

  it("unlocks diagram controls only after the source image decodes", async () => {
    let finishDecode: (() => void) | undefined;
    const decode = vi
      .fn<() => Promise<void>>()
      // Next/Image currently decodes before forwarding its onLoad callback.
      // The component then performs its own explicit readiness decode.
      .mockResolvedValueOnce()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishDecode = resolve;
          }),
      );
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });

    await act(async () => {
      root.render(
        <ContextDiagramView
          block={diagramBlock}
          caption={diagramBlock.caption}
          captionId="system-caption"
          descriptionId="system-description"
        />,
      );
    });

    const scrollRegion = container.querySelector<HTMLElement>(
      ".context-diagram-scroll",
    );
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".context-diagram-controls button",
      ),
    );
    expect(
      container.querySelector('[data-visual-state="deferred"]'),
    ).not.toBeNull();
    expect(scrollRegion?.getAttribute("aria-busy")).toBe("false");
    expect(scrollRegion?.tabIndex).toBe(-1);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(container.querySelector(".context-visual-spinner")).toBeNull();

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
    });
    expect(
      container.querySelector('[data-visual-state="loading"]'),
    ).not.toBeNull();
    expect(scrollRegion?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll(".context-visual-spinner")).toHaveLength(
      1,
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      container.querySelector('[role="status"]')?.closest('[aria-busy="true"]'),
    ).toBeNull();

    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-visual-state="loading"]'),
    ).not.toBeNull();

    await act(async () => {
      finishDecode?.();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-visual-state="ready"]'),
    ).not.toBeNull();
    expect(scrollRegion?.getAttribute("aria-busy")).toBe("false");
    expect(scrollRegion?.tabIndex).toBe(0);
    expect(buttons[0]?.disabled).toBe(false);
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await act(async () => {
      buttons[0]?.click();
    });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Diagram zoom 125 percent",
    );
  });

  it("uses a stable three-by-two diagram footprint when either source dimension is absent", async () => {
    await act(async () => {
      root.render(
        <ContextDiagramView
          block={{
            ...diagramBlock,
            diagram: {
              ...diagramBlock.diagram,
              image: {
                ...diagramBlock.diagram.image,
                height: undefined,
              },
            },
          }}
          caption={diagramBlock.caption}
          captionId="system-caption"
          descriptionId="system-description"
        />,
      );
    });

    const surface = container.querySelector<HTMLElement>(
      ".context-diagram-surface",
    );
    const image = container.querySelector<HTMLImageElement>("img");
    expect(surface?.style.aspectRatio).toBe("3 / 2");
    expect(image?.getAttribute("width")).toBe("1200");
    expect(image?.getAttribute("height")).toBe("800");
  });

  it("accepts already-decoded diagram pixels when a repeat decode rejects", async () => {
    const decode = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Already decoded"));
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });

    await act(async () => {
      root.render(
        <ContextDiagramView
          block={diagramBlock}
          caption={diagramBlock.caption}
          captionId="system-caption"
          descriptionId="system-description"
        />,
      );
    });
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
    });
    const image = container.querySelector<HTMLImageElement>("img");
    expect(image).not.toBeNull();
    Object.defineProperties(image!, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 800 },
    });

    await act(async () => {
      image?.dispatchEvent(new Event("load"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(decode).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-visual-state="ready"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        ".context-diagram-controls button",
      )?.disabled,
    ).toBe(false);
  });

  it("keeps semantic diagram content when the source image fails", async () => {
    await act(async () => {
      root.render(
        <ContextDiagramView
          block={diagramBlock}
          caption={diagramBlock.caption}
          captionId="system-caption"
          descriptionId="system-description"
        />,
      );
    });
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });

    expect(
      container.querySelector('[data-visual-state="error"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector(".context-diagram-scroll")
        ?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector<HTMLElement>(".context-diagram-scroll")?.tabIndex,
    ).toBe(-1);
    expect(container.querySelector(".context-visual-spinner")).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".context-diagram-controls button",
        ),
      ).every((button) => button.disabled),
    ).toBe(true);
    expect(container.textContent).toContain("First part");
    expect(container.textContent).toContain("flows into");
    expect(container.textContent).toContain("Begin at the first part");
  });
});
