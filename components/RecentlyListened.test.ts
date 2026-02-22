import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTimeAgo } from "./RecentlyListened";

describe("formatTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now)).toBe("just now");
    expect(formatTimeAgo(now - 30_000)).toBe("just now");
    expect(formatTimeAgo(now - 59_000)).toBe("just now");
  });

  it('returns "Xm ago" for timestamps 1-59 minutes ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 60_000)).toBe("1m ago");
    expect(formatTimeAgo(now - 5 * 60_000)).toBe("5m ago");
    expect(formatTimeAgo(now - 59 * 60_000)).toBe("59m ago");
  });

  it('returns "Xh ago" for timestamps 1-23 hours ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 60 * 60_000)).toBe("1h ago");
    expect(formatTimeAgo(now - 12 * 60 * 60_000)).toBe("12h ago");
    expect(formatTimeAgo(now - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it('returns "yesterday" for timestamps 24-47 hours ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 24 * 60 * 60_000)).toBe("yesterday");
    expect(formatTimeAgo(now - 36 * 60 * 60_000)).toBe("yesterday");
  });

  it('returns "Xd ago" for timestamps 2-6 days ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 2 * 24 * 60 * 60_000)).toBe("2d ago");
    expect(formatTimeAgo(now - 6 * 24 * 60 * 60_000)).toBe("6d ago");
  });

  it("returns formatted date for timestamps 7+ days ago", () => {
    const now = Date.now();
    const result = formatTimeAgo(now - 14 * 24 * 60 * 60_000);
    expect(result).toMatch(/Feb\s+7/);
  });

  it("returns formatted date for timestamps months ago", () => {
    const old = new Date("2025-12-25T12:00:00Z").getTime();
    const result = formatTimeAgo(old);
    expect(result).toMatch(/Dec\s+25/);
  });
});
