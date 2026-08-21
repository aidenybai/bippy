import { describe, expect, it } from "vite-plus/test";
import { getFlamegraphChartData, getRankedChartData } from "../src/profiling-charts.js";
import type { ProfilingChartNode } from "../src/profiling-charts.js";

const nodes: ProfilingChartNode[] = [
  {
    actualDuration: 15,
    children: [2, 3],
    didRender: true,
    id: 1,
    name: "Parent",
    parentId: null,
    selfDuration: 10,
    treeBaseDuration: 15,
  },
  {
    actualDuration: 3,
    children: [],
    didRender: true,
    id: 2,
    key: "first",
    name: "Child",
    parentId: 1,
    selfDuration: 3,
    treeBaseDuration: 3,
  },
  {
    actualDuration: 2,
    children: [],
    didRender: true,
    id: 3,
    name: "Child",
    parentId: 1,
    selfDuration: 2,
    treeBaseDuration: 2,
  },
];

describe("upstream profiling chart behavior", () => {
  it("should contain valid data", () => {
    const rows = getFlamegraphChartData(nodes);
    expect(rows[0]?.[0]).toMatchObject({ id: 1, offset: 0 });
    expect(rows[1]).toEqual([
      expect.objectContaining({ id: 2, offset: 10 }),
      expect.objectContaining({ id: 3, offset: 13 }),
    ]);
  });

  it("should place children of a bailed-out parent against its tree base duration", () => {
    const updated = nodes.map((node) =>
      node.id === 1 ? { ...node, actualDuration: 0, didRender: false, selfDuration: 0 } : node,
    );
    const rows = getFlamegraphChartData(updated);
    expect(rows[0]?.[0]).toMatchObject({ id: 1, offset: 0 });
    expect(rows[1]).toEqual([
      expect.objectContaining({ id: 2, offset: 10 }),
      expect.objectContaining({ id: 3, offset: 13 }),
    ]);
  });

  it("should contain valid data", () => {
    expect(getRankedChartData(nodes).map((node) => node.id)).toEqual([2, 3]);
  });

  it("should not report a component as re-rendered when its filtered parent bailed out", () => {
    const updated = nodes.map((node) => ({ ...node, didRender: node.id === 1 }));
    expect(getRankedChartData(updated)).toEqual([]);
  });

  it("should not report a component as re-rendered when behind a filtered fragment", () => {
    const updated = nodes.map((node) => ({ ...node, didRender: false }));
    expect(getRankedChartData(updated)).toEqual([]);
  });

  it("should correctly report sibling components that did not re-render", () => {
    const updated = nodes.map((node) => ({ ...node, didRender: node.id !== 3 }));
    expect(getRankedChartData(updated).map((node) => node.id)).toEqual([2]);
  });
});
