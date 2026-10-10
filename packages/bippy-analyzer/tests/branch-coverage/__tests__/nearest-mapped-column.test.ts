import { describe, expect, it } from "vite-plus/test";
import { nearestMappedColumn } from "../report.js";

describe("nearestMappedColumn", () => {
  const columns = [0, 10, 20];

  it("returns null when no columns are mapped on the line", () => {
    expect(nearestMappedColumn([], 5)).toBeNull();
  });

  it("returns the column at or before the target when it is closest", () => {
    expect(nearestMappedColumn(columns, 25)).toBe(20);
    expect(nearestMappedColumn(columns, 12)).toBe(10);
  });

  it("returns the column after the target when it is strictly closer", () => {
    expect(nearestMappedColumn(columns, 18)).toBe(20);
  });

  it("returns the first column when the target precedes all mappings", () => {
    expect(nearestMappedColumn([10, 20], 5)).toBe(10);
  });

  it("returns an exact match", () => {
    expect(nearestMappedColumn(columns, 10)).toBe(10);
  });
});
