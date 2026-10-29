import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";
import { forEachRenderNode } from "../../src/core/states/for-each-render-node";
import type { SymbolicValue } from "../../src/core/types";

const countMappedRows = (render: SymbolicValue): number => {
  let rows = 0;
  forEachRenderNode(render, (node) => {
    if (node.kind === "ArrayMap") rows++;
  });
  return rows;
};

describe("rows built from a length", () => {
  const project = analyzeFixture("symbolic-tree", "rows-from-length.tsx");

  it("maps Array.from with a callback like an array map", () => {
    const list = getComponent(project, "FromLength");
    expect(countMappedRows(list.analysis.render)).toBe(1);
    expect(list.analysis.bailouts).toEqual([]);
  });

  it("does not report an untyped item nothing reads", () => {
    const list = getComponent(project, "SpreadArray");
    expect(countMappedRows(list.analysis.render)).toBe(1);
    expect(list.analysis.bailouts).toEqual([]);
  });
});
