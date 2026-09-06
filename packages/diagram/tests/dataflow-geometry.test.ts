import assert from "node:assert/strict";
import { test } from "node:test";
import { getDataflowOffsets } from "../src/diagram/dataflow-geometry";
import { diagramMetrics, getLabelWidth } from "../src/diagram/geometry";
import type { DataflowNode, DataflowEdge } from "../src/diagram/dataflow-model";
import { dataflowNodes } from "../src/board/dataflow-fixture";

const source: DataflowNode = { id: "source", label: "query", annotation: '"rea"', x: 20, y: 20 };
const target: DataflowNode = { id: "target", label: "onQueryChange", x: 220, y: 20 };
const edge: DataflowEdge = { id: "edge", from: source.id, to: target.id, kind: "data" };
const radius = diagramMetrics.nodeRadius + diagramMetrics.strokeWidth / 2;

test("uses equal label clearance in either direction and stops at node outlines", () => {
  assert.deepEqual(getDataflowOffsets(edge, source, target), {
    fromOffset: { x: getLabelWidth(source) + 4, y: 0 },
    toOffset: { x: -radius, y: 0 },
  });
  assert.deepEqual(getDataflowOffsets({ ...edge, kind: "update" }, target, source), {
    fromOffset: { x: -radius, y: 0 },
    toOffset: { x: getLabelWidth(source) + 4, y: 0 },
  });
});

test("uses the actual first and last nonzero segments for vertical ports", () => {
  const below = { ...target, x: source.x, y: 100 };
  assert.deepEqual(getDataflowOffsets(edge, source, below), {
    fromOffset: { x: 0, y: radius },
    toOffset: { x: 0, y: -radius },
  });
  assert.deepEqual(
    getDataflowOffsets(
      {
        ...edge,
        waypoints: [
          source,
          { x: source.x, y: 100 },
          { x: target.x - 20, y: 100 },
          { x: target.x - 20, y: target.y },
          target,
        ],
      },
      source,
      target,
    ),
    { fromOffset: { x: 0, y: radius }, toOffset: { x: -radius, y: 0 } },
  );
});

test("preserves explicit offsets and handles coincident endpoints", () => {
  const fromOffset = { x: 2, y: 3 };
  const toOffset = { x: -2, y: -3 };
  assert.deepEqual(getDataflowOffsets({ ...edge, fromOffset, toOffset }, source, target), {
    fromOffset,
    toOffset,
  });
  assert.deepEqual(getDataflowOffsets(edge, source, source), {
    fromOffset: { x: 0, y: 0 },
    toOffset: { x: 0, y: 0 },
  });
});

test("callback props are value ports, not updater operations", () => {
  for (const node of dataflowNodes.filter((node) => node.label.startsWith("on"))) {
    assert.equal(node.kind, "value");
    assert.equal(node.tone, "orange");
  }
  for (const nodeId of ["set-query", "dispatch", "store-add"])
    assert.equal(dataflowNodes.find((node) => node.id === nodeId)?.kind, "callback");
});
