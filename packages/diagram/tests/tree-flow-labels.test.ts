import assert from "node:assert/strict";
import { test } from "node:test";
import { getCurvePoint, diagramMetrics } from "../src/diagram/geometry";
import { getTreeFlowLabelPositions, type TreeFlowLabel } from "../src/diagram/tree-flow-labels";

const positions = Array.from({ length: 6 }, (_, index) => ({ x: 80, y: index * 24 + 12 }));
const edge: TreeFlowLabel = {
  id: "snapshot",
  label: "snapshot.count",
  from: positions[0],
  to: positions[4],
  bend: 24,
};

test("curve sampling preserves both endpoints and the midpoint", () => {
  assert.deepEqual(getCurvePoint(edge, 0), edge.from);
  assert.deepEqual(getCurvePoint(edge, 1), edge.to);
  assert.deepEqual(getCurvePoint(edge, 0.5), { x: 62, y: 60 });
});

test("tree flow labels use row gaps instead of the midpoint row", () => {
  const position = getTreeFlowLabelPositions([edge], positions, 260).get(edge.id);
  assert.ok(position);
  assert.equal(position.y, 48 + diagramMetrics.fontSize * 0.32);
});

test("opposing labels get distinct gaps and stay inside the viewport", () => {
  const reverse = { ...edge, id: "reverse", from: edge.to, to: edge.from };
  const labels = getTreeFlowLabelPositions([edge, reverse], positions, 100);
  assert.equal(labels.size, 2);
  assert.equal(new Set([...labels.values()].map((position) => position.y)).size, 2);
  for (const position of labels.values()) assert.ok(position.x >= 4 && position.x <= 17);
  assert.deepEqual(labels, getTreeFlowLabelPositions([reverse, edge], positions, 100));
});

test("labels do not overflow narrow views or pack into undersized gaps", () => {
  assert.equal(getTreeFlowLabelPositions([edge], positions, 30).size, 0);
  assert.equal(
    getTreeFlowLabelPositions(
      [edge],
      [
        { x: 80, y: 12 },
        { x: 80, y: 24 },
      ],
      260,
    ).size,
    0,
  );
});
