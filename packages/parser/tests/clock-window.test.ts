import { describe, expect, it } from "vite-plus/test";
import {
  getClockFieldRange,
  getClockTimezoneOffset,
  getWindowedFieldRange,
} from "../src/evaluate/clock-date.js";
import { readClockTime } from "../src/harness/clock-window.js";
import type { CapturedClockWindow } from "../src/types.js";

const windowBetween = (start: Date, end: Date): CapturedClockWindow => ({
  start: readClockTime(start),
  end: readClockTime(end),
});

describe("clock window bounds on new Date()", () => {
  const morning = new Date(Date.UTC(2026, 8, 9, 10, 15, 30, 250));
  const laterThatHour = new Date(Date.UTC(2026, 8, 9, 10, 42, 5, 900));
  const nextMidnight = new Date(Date.UTC(2026, 8, 10, 0, 0, 0, 0));

  it("follows the window while every coarser field agrees at both ends", () => {
    const start = readClockTime(morning).utc;
    const end = readClockTime(laterThatHour).utc;
    expect(getWindowedFieldRange(start, end, "year")).toEqual({ min: 2026, max: 2026 });
    expect(getWindowedFieldRange(start, end, "hours")).toEqual({ min: 10, max: 10 });
    expect(getWindowedFieldRange(start, end, "minutes")).toEqual({ min: 15, max: 42 });
    expect(getWindowedFieldRange(start, end, "day")).toEqual({ min: 3, max: 3 });
  });

  it("falls back to the calendar's bounds once a coarser field wraps", () => {
    const start = readClockTime(morning).utc;
    const end = readClockTime(nextMidnight).utc;
    expect(getWindowedFieldRange(start, end, "month")).toEqual({ min: 8, max: 8 });
    expect(getWindowedFieldRange(start, end, "date")).toEqual({ min: 9, max: 10 });
    expect(getWindowedFieldRange(start, end, "hours")).toEqual({ min: 0, max: 23 });
    expect(getWindowedFieldRange(start, end, "seconds")).toEqual({ min: 0, max: 59 });
    expect(getWindowedFieldRange(start, end, "day")).toEqual({ min: 0, max: 6 });
  });

  it("keeps the calendar's bounds without a window", () => {
    expect(getClockFieldRange(null, "year", true)).toBeNull();
    expect(getClockFieldRange(null, "month", false)).toEqual({ min: 0, max: 11 });
    expect(getClockTimezoneOffset(null)).toBeNull();
  });

  it("reads the offset and local fields only while both ends share a UTC offset", () => {
    const window = windowBetween(morning, laterThatHour);
    expect(getClockTimezoneOffset(window)).toBe(morning.getTimezoneOffset());
    expect(getClockFieldRange(window, "year", false)).toEqual({ min: 2026, max: 2026 });
    const shifted: CapturedClockWindow = {
      start: window.start,
      end: { ...window.end, timezoneOffset: window.end.timezoneOffset + 60 },
    };
    expect(getClockTimezoneOffset(shifted)).toBeNull();
    expect(getClockFieldRange(shifted, "hours", false)).toEqual({ min: 0, max: 23 });
    expect(getClockFieldRange(shifted, "year", false)).toBeNull();
    expect(getClockFieldRange(shifted, "hours", true)).toEqual({ min: 10, max: 10 });
  });

  it("trusts nothing from a window whose clock ran backwards", () => {
    const window = windowBetween(laterThatHour, morning);
    expect(getClockFieldRange(window, "year", true)).toBeNull();
    expect(getClockFieldRange(window, "minutes", true)).toEqual({ min: 0, max: 59 });
  });
});
