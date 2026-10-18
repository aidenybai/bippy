import assert from "node:assert/strict";
import { test } from "node:test";
import { diagramMetrics, getEdgePath, getEdgeLabelPosition } from "../src/diagram/geometry";
import { chartNodes, relationshipEdges, relationshipNodes } from "../src/board/fixtures";

test("uses one row grid in every static composition", () => {
  for (const node of relationshipNodes) assert.equal((node.y - 40) % diagramMetrics.rowHeight, 0);
});

test("derives parent and owner edges from the same component model", () => {
  for (const node of chartNodes) {
    for (const relation of ["parent", "owner"]) {
      const parentId = relation === "parent" ? node.parentId : node.ownerId;
      if (!parentId) continue;
      assert.ok(
        relationshipEdges.some(
          (edge) =>
            edge.from === `${relation}-${parentId}` &&
            edge.to === `${relation}-${node.id}` &&
            !edge.kind,
        ),
      );
    }
  }
});

test("host nodes stay host nodes when used as portal targets", () => {
  const target = relationshipNodes.find((node) => node.id === "dom-defs");
  assert.equal(target?.kind, "host");
  assert.equal(target?.isPortalTarget, true);
});

test("connects parent edges at exact node centers", () => {
  assert.equal(getEdgePath({ from: { x: 24, y: 28 }, to: { x: 48, y: 56 } }), "M 24 28 V 56 H 48");
});

test("places reference labels on the curve or at an explicit annotation point", () => {
  const edge = {
    from: { x: 100, y: 100 },
    to: { x: 100, y: 200 },
    kind: "reference",
  } satisfies Parameters<typeof getEdgeLabelPosition>[0];
  assert.deepEqual(getEdgeLabelPosition(edge), { x: 50, y: 144 });
  assert.deepEqual(getEdgeLabelPosition({ ...edge, labelPosition: { x: 30, y: 40 } }), {
    x: 30,
    y: 40,
  });
});
