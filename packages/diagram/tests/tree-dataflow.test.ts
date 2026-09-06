import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeRows } from "../src/diagram/tree-model";
import { getOwnerNodes } from "../src/diagram/tree-highlight";
import { getDataflowIndex, getDataflowHighlight } from "../src/diagram/dataflow-model";
import { getDataflowOffsets } from "../src/diagram/dataflow-geometry";
import { diagramMetrics, getEdgePath } from "../src/diagram/geometry";
import {
  treeDataflowNodes,
  treeDataflowEdges,
  treeDataflowPorts,
} from "../src/board/tree-dataflow-fixture";

test("keeps metadata rows under their components in parent and owner projections", () => {
  for (const nodes of [treeDataflowNodes, getOwnerNodes(treeDataflowNodes)]) {
    const rows = getTreeRows(nodes);
    for (const row of rows) {
      if (!row.node.componentId) continue;
      assert.equal(rows[row.parentIndex].node.id, row.node.componentId);
      assert.equal(row.depth, rows[row.parentIndex].depth + 1);
    }
  }
});

test("traces the inline model without turning component membership into data dependencies", () => {
  const index = getDataflowIndex(treeDataflowNodes, treeDataflowEdges);
  const query = getDataflowHighlight(index, "query-state");
  assert.ok(query.nodeIds.has("feed-items"));
  assert.ok(query.nodeIds.has("item-content"));
  assert.equal(query.nodeIds.has("todos-reducer"), false);
  const derived = getDataflowHighlight(index, "visible-todos");
  assert.ok(derived.nodeIds.has("query-state"));
  assert.ok(derived.nodeIds.has("todos-reducer"));
  for (const port of treeDataflowPorts) assert.equal(port.tone, undefined);
});

test("bounds long connections horizontally and preserves arrow clearance on curved links", () => {
  const from = { id: "source", label: "source", x: 80, y: 20 };
  const to = { id: "target", label: "target", x: 200, y: 1000 };
  assert.equal(getEdgePath({ from, to, shape: "curve" }), "M 80 20 C 40 20 40 1000 200 1000");
  const offsets = getDataflowOffsets(
    { id: "edge", from: from.id, to: to.id, kind: "data", shape: "curve" },
    from,
    to,
  );
  assert.equal(offsets.fromOffset.x, -diagramMetrics.nodeRadius - diagramMetrics.strokeWidth / 2);
  assert.equal(offsets.toOffset.x, offsets.fromOffset.x - diagramMetrics.arrowGap);
  assert.equal(offsets.toOffset.y, 0);
});
