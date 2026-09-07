import assert from "node:assert/strict";
import { test } from "node:test";
import { getDataflowOffsets } from "../src/diagram/dataflow-geometry";
import { diagramMetrics } from "../src/diagram/geometry";
import type { DataflowNode } from "../src/diagram/dataflow-model";

interface ComponentPortCase {
  componentType: NonNullable<DataflowNode["componentType"]>;
  boundary: number;
}

const strokeRadius = diagramMetrics.strokeWidth / 2;
const cases: ComponentPortCase[] = [
  { componentType: "class", boundary: diagramMetrics.nodeRadius + strokeRadius },
  { componentType: "memo", boundary: (diagramMetrics.nodeRadius + strokeRadius * Math.SQRT2) / 2 },
  {
    componentType: "forward-ref",
    boundary: (diagramMetrics.nodeRadius + strokeRadius * Math.SQRT2) / 2,
  },
];

for (const { componentType, boundary } of cases) {
  test(`${componentType} ports leave the arrow tip three pixels outside the glyph`, () => {
    const { toOffset } = getDataflowOffsets(
      { id: "edge", from: "source", to: "target", kind: "data", waypoints: [] },
      { id: "source", label: "Source", x: -40, y: -40 },
      { id: "target", label: "Target", x: 0, y: 0, componentType },
    );
    assert.ok(
      Math.abs(Math.hypot(toOffset.x + boundary, toOffset.y + boundary) - diagramMetrics.arrowGap) <
        0.001,
    );
  });
}
