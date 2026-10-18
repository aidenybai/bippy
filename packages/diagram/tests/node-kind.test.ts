import assert from "node:assert/strict";
import { test } from "node:test";
import { getIsCallableNode } from "../src/diagram/node-kind";
import { diagramMetrics, getLabelWidth } from "../src/diagram/geometry";

test("marks callable kinds and explicit function values without guessing from names", () => {
  assert.equal(getIsCallableNode({ kind: "hook" }), true);
  assert.equal(getIsCallableNode({ kind: "callback" }), true);
  assert.equal(getIsCallableNode({ kind: "value" }), false);
  assert.equal(getIsCallableNode({ kind: "component" }), false);
  assert.equal(getIsCallableNode({ kind: "value", isCallable: true }), true);
  assert.equal(getIsCallableNode({ kind: "store", isCallable: true }), true);
  assert.equal(getIsCallableNode({ kind: "hook", isCallable: false }), false);
});

test("includes the function symbol in label, hitbox, and port measurements", () => {
  const plainWidth = getLabelWidth({ label: "onClick" });
  const functionWidth = getLabelWidth({ label: "onClick", isCallable: true });
  assert.ok(Math.abs(functionWidth - plainWidth - 2 * diagramMetrics.fontSize * 0.61) < 0.001);
});
