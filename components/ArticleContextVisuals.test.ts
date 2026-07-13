import { describe, expect, it, vi } from "vitest";
import type { ContextMapBlock } from "@/lib/article-context-types";
import {
  fitMapToFeatures,
  getFallbackBarGeometry,
  getMapFeatureBounds,
} from "./ArticleContextVisuals";

const mapBlock = (
  map: ContextMapBlock["map"],
): ContextMapBlock => ({ map }) as ContextMapBlock;

describe("article context fallback chart geometry", () => {
  it("anchors positive and negative bars to the same zero baseline", () => {
    const negative = getFallbackBarGeometry(-10, -10, 10);
    const positive = getFallbackBarGeometry(10, -10, 10);

    expect(negative.zeroY).toBeCloseTo(positive.zeroY);
    expect(negative.y).toBeCloseTo(negative.zeroY);
    expect(negative.height).toBeGreaterThan(0);
    expect(positive.y).toBeLessThan(positive.zeroY);
    expect(positive.y + positive.height).toBeCloseTo(positive.zeroY);
  });

  it("places zero at the top when every fallback bar is negative", () => {
    const negative = getFallbackBarGeometry(-5, -10, 0);

    expect(negative.zeroY).toBe(24);
    expect(negative.y).toBe(negative.zeroY);
    expect(negative.height).toBeGreaterThan(0);
  });
});

describe("article context map camera", () => {
  it("fits the extrema from places, routes, and areas without including the source center", () => {
    const block = mapBlock({
      center: { latitude: 47, longitude: 4 },
      suggestedZoom: 4,
      places: [
        { id: "west", name: "West", latitude: 48, longitude: -11 },
      ],
      routes: [
        {
          id: "south-route",
          name: "South route",
          points: [
            { latitude: 40, longitude: 2 },
            { latitude: 33, longitude: 6 },
          ],
        },
      ],
      areas: [
        {
          id: "northeast-area",
          name: "Northeast area",
          rings: [[
            { latitude: 55, longitude: 12 },
            { latitude: 61, longitude: 18 },
            { latitude: 58, longitude: 15 },
          ]],
        },
      ],
    });

    expect(getMapFeatureBounds(block)).toEqual([[-11, 33], [18, 61]]);
  });

  it("uses the compact antimeridian-crossing interval", () => {
    const block = mapBlock({
      center: { latitude: 0, longitude: 180 },
      places: [
        { id: "west", name: "West", latitude: -10, longitude: 179 },
        { id: "east", name: "East", latitude: 12, longitude: -179 },
      ],
      routes: [],
      areas: [],
    });

    expect(getMapFeatureBounds(block)).toEqual([[179, -10], [181, 12]]);
  });

  it("fits multiple features and centers a lone feature instead of a stale source center", () => {
    const multiPoint = mapBlock({
      center: { latitude: 34, longitude: -99.5 },
      suggestedZoom: 4,
      places: [
        { id: "vancouver", name: "Vancouver", latitude: 49.28, longitude: -123.12 },
        { id: "mexico-city", name: "Mexico City", latitude: 19.43, longitude: -99.13 },
      ],
      routes: [],
      areas: [],
    });
    const fitBounds = vi.fn();
    const jumpTo = vi.fn();

    expect(fitMapToFeatures({ fitBounds, jumpTo }, multiPoint)).toBe("features");
    expect(fitBounds).toHaveBeenCalledWith(
      [[-123.12, 19.43], [-99.13, 49.28]],
      {
        padding: 40,
        maxZoom: 10,
        duration: 0,
        bearing: 0,
        pitch: 0,
        roll: 0,
      },
    );
    expect(jumpTo).not.toHaveBeenCalled();

    const onePoint = mapBlock({
      center: { latitude: 0, longitude: 0 },
      suggestedZoom: 7,
      places: [
        { id: "rome", name: "Rome", latitude: 41.9, longitude: 12.5 },
      ],
      routes: [],
      areas: [],
    });
    fitBounds.mockClear();
    jumpTo.mockClear();

    expect(fitMapToFeatures({ fitBounds, jumpTo }, onePoint)).toBe("features");
    expect(fitBounds).not.toHaveBeenCalled();
    expect(jumpTo).toHaveBeenCalledWith({
      center: [12.5, 41.9],
      zoom: 7,
      bearing: 0,
      pitch: 0,
      roll: 0,
    });
  });

  it("falls back to the source camera only when no features exist", () => {
    const block = mapBlock({
      center: { latitude: 51.5, longitude: -0.12 },
      suggestedZoom: 6,
      places: [],
      routes: [],
      areas: [],
    });
    const fitBounds = vi.fn();
    const jumpTo = vi.fn();

    expect(fitMapToFeatures({ fitBounds, jumpTo }, block)).toBe("source");
    expect(fitBounds).not.toHaveBeenCalled();
    expect(jumpTo).toHaveBeenCalledWith({
      center: [-0.12, 51.5],
      zoom: 6,
      bearing: 0,
      pitch: 0,
      roll: 0,
    });
  });
});
