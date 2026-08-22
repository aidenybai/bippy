import { describe, expect, it } from "vite-plus/test";
import { groupAndSortNodes } from "../src/trace-updates.js";
import type { TraceUpdateData } from "../src/trace-updates.js";

const createData = (
  displayName: string,
  count: number,
  left: number,
  width = 100,
): TraceUpdateData => ({
  color: `color-${displayName}`,
  count,
  displayName,
  rect: { height: width, left, top: 0, width },
});

describe("upstream trace-update grouping behavior", () => {
  it("should group nodes by position without changing order within group", () => {
    const first = createData("Node1", 3, 0);
    const second = createData("Node2", 2, 0);
    expect(
      groupAndSortNodes(
        new Map([
          [{}, first],
          [{}, second],
        ]),
      ),
    ).toEqual([[first, second]]);
  });

  it("should sort groups by lowest count in each group", () => {
    const first = createData("Group1", 4, 0);
    const second = createData("Group2", 1, 100);
    const third = createData("Group3", 2, 200);
    expect(
      groupAndSortNodes(
        new Map([
          [{}, first],
          [{}, second],
          [{}, third],
        ]),
      ),
    ).toEqual([[second], [third], [first]]);
  });

  it("should maintain order within groups while sorting groups by lowest count", () => {
    const first = createData("Pos1Node1", 4, 0, 50);
    const second = createData("Pos1Node2", 2, 0, 60);
    const third = createData("Pos2Node1", 3, 100, 70);
    const fourth = createData("Pos2Node2", 1, 100, 80);
    expect(
      groupAndSortNodes(
        new Map([
          [{}, first],
          [{}, second],
          [{}, third],
          [{}, fourth],
        ]),
      ),
    ).toEqual([
      [third, fourth],
      [first, second],
    ]);
  });

  it("should handle multiple groups with same minimum count", () => {
    const first = createData("Group1", 1, 0);
    const second = createData("Group2", 1, 100);
    expect(
      groupAndSortNodes(
        new Map([
          [{}, first],
          [{}, second],
        ]),
      ),
    ).toEqual([[first], [second]]);
  });

  it("should filter out nodes without rect property", () => {
    const missing: TraceUpdateData = { color: "a", count: 1, displayName: "Missing", rect: null };
    const undefinedRectangle: TraceUpdateData = {
      color: "b",
      count: 2,
      displayName: "Undefined",
    };
    const valid = createData("Valid", 3, 0);
    expect(
      groupAndSortNodes(
        new Map([
          [{}, missing],
          [{}, undefinedRectangle],
          [{}, valid],
        ]),
      ),
    ).toEqual([[valid]]);
  });
});
