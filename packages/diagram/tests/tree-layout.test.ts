import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeRows } from "../src/diagram/tree-model";
import { getTreeLayout } from "../src/diagram/tree-layout";
import { diagramMetrics } from "../src/diagram/geometry";

const rows = getTreeRows([
  { id: "stats", label: "Stats" },
  { id: "count", label: "props.count", parentId: "stats", componentId: "stats" },
  { id: "context", label: "useContext", parentId: "stats", componentId: "stats" },
  { id: "section", label: "section", parentId: "stats" },
  { id: "strong", label: "strong", parentId: "section" },
  { id: "content", label: "props.children", parentId: "strong", componentId: "strong" },
]);

test("aligns compact details with the component label, not a child-node level", () => {
  const { positions, offsets } = getTreeLayout(rows);
  assert.equal(positions[1].x, positions[0].x + diagramMetrics.labelOffset);
  assert.equal(positions[2].x, positions[1].x);
  assert.equal(positions[3].x, positions[0].x + diagramMetrics.indent);
  assert.equal(positions[5].x, positions[4].x + diagramMetrics.labelOffset);
  assert.equal(offsets[2] - offsets[1], diagramMetrics.detailRowHeight);
  assert.equal(offsets[3] - offsets[2], diagramMetrics.detailRowHeight);
  assert.equal(offsets[4] - offsets[3], diagramMetrics.rowHeight);
  assert.equal(
    offsets[rows.length],
    diagramMetrics.rowHeight * 3 + diagramMetrics.detailRowHeight * 3,
  );
});

test("preserves the regular grid for component-only trees and empty inputs", () => {
  const components = getTreeRows([
    { id: "root", label: "Root" },
    { id: "child", label: "Child", parentId: "root" },
  ]);
  assert.deepEqual(getTreeLayout(components).positions, [
    { x: 40, y: 10 },
    { x: 60, y: 30 },
  ]);
  assert.deepEqual(getTreeLayout([]), { positions: [], offsets: [0] });
});
