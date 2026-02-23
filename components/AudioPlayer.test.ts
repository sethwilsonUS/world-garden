import { describe, it, expect } from "vitest";
import { formatTime } from "@/lib/formatTime";

describe("formatTime", () => {
  it("formats zero seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(30)).toBe("0:30");
    expect(formatTime(59)).toBe("0:59");
  });

  it("formats exact minutes", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(120)).toBe("2:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(605)).toBe("10:05");
  });

  it("pads seconds with leading zero", () => {
    expect(formatTime(63)).toBe("1:03");
    expect(formatTime(301)).toBe("5:01");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(1.7)).toBe("0:01");
    expect(formatTime(59.9)).toBe("0:59");
    expect(formatTime(90.5)).toBe("1:30");
  });

  it("returns 0:00 for negative values", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(-100)).toBe("0:00");
  });

  it("returns 0:00 for NaN", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("returns 0:00 for Infinity", () => {
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-Infinity)).toBe("0:00");
  });
});
