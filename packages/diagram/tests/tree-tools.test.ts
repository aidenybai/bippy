import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeRows } from "../src/diagram/tree-model";
import { getCollapsedTreeIds, getRevealedTreeIds } from "../src/diagram/tree-expansion";
import { getTreeFlowLanes } from "../src/diagram/tree-flow-lanes";
import type { DataflowEdge } from "../src/diagram/dataflow-model";
import { getIsCallableNode } from "../src/diagram/node-kind";

const rows = getTreeRows([
  { id: "root", label: "Root" },
  { id: "branch", label: "Branch", parentId: "root" },
  { id: "leaf", label: "Leaf", parentId: "branch" },
  { id: "other", label: "Other", parentId: "root" },
]);

test("bulk collapse and reveal only open the necessary ancestors", () => {
  const collapsed = getCollapsedTreeIds(rows);
  assert.deepEqual([...collapsed], ["root", "branch"]);
  assert.deepEqual([...getRevealedTreeIds(rows, "other", collapsed)], ["branch"]);
  assert.equal(getRevealedTreeIds(rows, "leaf", collapsed).size, 0);
  assert.equal(collapsed.size, 2);
  assert.deepEqual(getRevealedTreeIds(rows, "missing", collapsed), collapsed);
});

test("overlapping and opposing edges use separate deterministic lanes", () => {
  const index = new Map(rows.map((row, order) => [row.node.id, order]));
  const edges: DataflowEdge[] = [
    { id: "first", from: "root", to: "branch", kind: "data" },
    { id: "opposing", from: "branch", to: "root", kind: "update" },
    { id: "long", from: "root", to: "other", kind: "data" },
    { id: "tail", from: "leaf", to: "other", kind: "data" },
  ];
  const { lanes } = getTreeFlowLanes(edges, index);
  assert.notEqual(lanes.get("first"), lanes.get("opposing"));
  assert.notEqual(lanes.get("first"), lanes.get("long"));
  assert.notEqual(lanes.get("long"), lanes.get("tail"));
  assert.equal(lanes.get("first"), lanes.get("tail"));
  assert.deepEqual(getTreeFlowLanes([...edges].reverse(), index).lanes, lanes);
});

test("function components are explicit rather than inferred from class or wrapper names", () => {
  assert.equal(getIsCallableNode({ componentType: "function" }), true);
  assert.equal(getIsCallableNode({ componentType: "class" }), false);
  assert.equal(getIsCallableNode({ componentType: "memo" }), false);
  assert.equal(getIsCallableNode({ componentType: "forward-ref" }), false);
});
