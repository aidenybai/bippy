import assert from "node:assert/strict";
import { test } from "node:test";
import { getDataflowIndex, getDataflowHighlight } from "../src/diagram/dataflow-model";
import { dataflowNodes, dataflowEdges } from "../src/board/dataflow-fixture";
import { getEdgePath, getEdgeLabelPosition } from "../src/diagram/geometry";

const index = getDataflowIndex(dataflowNodes, dataflowEdges);

test("traces state through props, derived values, and callback updates without flooding sibling hooks", () => {
  const highlight = getDataflowHighlight(index, "query-state");
  for (const nodeId of [
    "query",
    "toolbar-query",
    "input-value",
    "input-change",
    "set-query",
    "visible-todos",
    "list-items",
    "item-todo",
    "flow-app",
  ])
    assert.ok(highlight.nodeIds.has(nodeId), nodeId);
  for (const nodeId of ["todos-reducer", "cart-hook", "theme-hook"])
    assert.equal(highlight.nodeIds.has(nodeId), false, nodeId);
  assert.ok(highlight.edgeIds.has("state-update"));
  assert.equal(highlight.edgeIds.has("reducer-result"), false);
});

test("derived values link useState and useReducer inputs", () => {
  const highlight = getDataflowHighlight(index, "visible-todos");
  for (const nodeId of ["query-state", "todos-reducer", "dispatch", "set-query", "list-items"])
    assert.ok(highlight.nodeIds.has(nodeId), nodeId);
});

test("external store cycles terminate and include reads, subscriptions, mutations, and rendered consumers", () => {
  const highlight = getDataflowHighlight(index, "cart-hook");
  for (const nodeId of ["get-snapshot", "subscribe", "cart-store", "cart-click", "span-content"])
    assert.ok(highlight.nodeIds.has(nodeId), nodeId);
  for (const edgeId of ["snapshot-read", "store-subscribe", "snapshot-changed", "store-mutation"])
    assert.ok(highlight.edgeIds.has(edgeId), edgeId);
  assert.equal(highlight.nodeIds.has("query-state"), false);
});

test("context reaches its hook and prop consumers, and component focus includes its ports", () => {
  const context = getDataflowHighlight(index, "theme-provider");
  assert.ok(context.nodeIds.has("theme-hook"));
  assert.ok(context.nodeIds.has("button-style"));
  const component = getDataflowHighlight(index, "toolbar");
  assert.ok(component.nodeIds.has("query-state"));
  assert.ok(component.nodeIds.has("input-change"));
});

test("rejects duplicate IDs and missing endpoints or components", () => {
  assert.throws(() => getDataflowIndex([dataflowNodes[0], dataflowNodes[0]], []), /Duplicate/);
  assert.throws(
    () => getDataflowIndex(dataflowNodes, [dataflowEdges[0], dataflowEdges[0]]),
    /Duplicate/,
  );
  assert.throws(() => getDataflowIndex([], dataflowEdges), /Missing endpoint/);
  assert.throws(() => getDataflowIndex([dataflowNodes[1]], []), /Missing parent/);
});

test("routes directed connections through explicit waypoints", () => {
  assert.deepEqual(
    getEdgeLabelPosition({
      from: { x: 10, y: 10 },
      to: { x: 50, y: 50 },
      waypoints: [
        { x: 30, y: 10 },
        { x: 30, y: 50 },
      ],
    }),
    { x: 30, y: 24 },
  );
  assert.equal(
    getEdgePath({
      from: { x: 10, y: 10 },
      to: { x: 50, y: 50 },
      waypoints: [
        { x: 30, y: 10 },
        { x: 30, y: 50 },
      ],
    }),
    "M 10 10 L 30 10 L 30 50 L 50 50",
  );
});
