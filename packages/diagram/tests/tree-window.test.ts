import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeWindow } from "../src/diagram/tree-window";

test("an empty tree has an empty window", () => {
  assert.deepEqual(getTreeWindow([0], 0, 240), {
    start: 0,
    end: 0,
    firstVisible: 0,
    lastVisible: 0,
    offset: 0,
    totalHeight: 0,
  });
});

test("windows respect variable row heights and exact viewport boundaries", () => {
  const range = getTreeWindow([0, 24, 64, 88], 24, 40, 0);
  assert.equal(range.start, 1);
  assert.equal(range.end, 2);
  assert.equal(range.offset, 24);
});

test("large models keep a bounded window with five overscan rows", () => {
  const offsets = Array.from({ length: 10001 }, (_, index) => index * 24);
  const range = getTreeWindow(offsets, 6000 * 24, 232);
  assert.equal(range.firstVisible, 6000);
  assert.equal(range.lastVisible, 6010);
  assert.equal(range.start, 5995);
  assert.equal(range.end, 6015);
  assert.equal(range.totalHeight, 240000);
});
