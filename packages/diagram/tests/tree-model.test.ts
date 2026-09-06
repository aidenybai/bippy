import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getExpandedRows,
  getIndentation,
  getNodeOffset,
  getTreeRows,
  getVirtualRange,
  type TreeNode,
} from "../src/diagram/tree-model";

const nodes: TreeNode[] = [
  { id: "root", label: "Root" },
  { id: "first", label: "First", parentId: "root" },
  { id: "leaf", label: "Leaf", parentId: "first" },
  { id: "second", label: "Second", parentId: "root" },
];

test("indexes preorder, parents, subtree boundaries, and sibling positions", () => {
  const rows = getTreeRows(nodes);
  assert.deepEqual(
    rows.map((row) => row.depth),
    [0, 1, 2, 1],
  );
  assert.deepEqual(
    rows.map((row) => row.parentIndex),
    [-1, 0, 1, 0],
  );
  assert.deepEqual(
    rows.map((row) => row.subtreeEnd),
    [4, 3, 3, 4],
  );
  assert.deepEqual(
    rows.map((row) => row.lastChildIndex),
    [3, 2, -1, -1],
  );
  assert.equal(rows[3].position, 2);
  assert.equal(rows[3].siblingCount, 2);
});

test("accepts unordered input and multiple roots", () => {
  const rows = getTreeRows([
    nodes[2],
    nodes[1],
    nodes[0],
    nodes[3],
    { id: "other", label: "Other" },
  ]);
  assert.deepEqual(
    rows.map((row) => row.node.id),
    ["root", "first", "leaf", "second", "other"],
  );
  assert.equal(rows[4].siblingCount, 2);
});

test("collapsing skips a subtree without changing absolute depth", () => {
  const rows = getTreeRows(nodes);
  assert.deepEqual(
    getExpandedRows(rows, new Set(["first"])).map((row) => row.node.id),
    ["root", "first", "second"],
  );
  assert.deepEqual(
    getExpandedRows(rows, new Set(["root"])).map((row) => row.node.id),
    ["root"],
  );
  assert.equal(getExpandedRows(rows, new Set())[2].depth, 2);
});

test("rejects duplicate IDs, missing parents, and cycles", () => {
  assert.throws(() => getTreeRows([nodes[0], nodes[0]]), /Duplicate/);
  assert.throws(() => getTreeRows([nodes[1]]), /Missing parent/);
  assert.throws(() => getTreeRows([{ id: "cycle", label: "Cycle", parentId: "cycle" }]), /cycle/);
  assert.throws(
    () =>
      getTreeRows([
        { id: "first", label: "First", parentId: "second" },
        { id: "second", label: "Second", parentId: "first" },
      ]),
    /cycle/,
  );
});

test("virtualizes only the visible rows plus overscan", () => {
  const range = getVirtualRange(10_000, 3_300, 396, 33);
  assert.deepEqual(range, {
    start: 95,
    end: 117,
    firstVisible: 100,
    lastVisible: 112,
    offset: 3135,
    totalHeight: 330000,
  });
  assert.equal(getVirtualRange(10_000, 0, 396, 33).start, 0);
  assert.equal(getVirtualRange(10_000, 999_999, 396, 33).end, 10_000);
});

test("clamps scroll after a collapse and handles an empty tree", () => {
  assert.equal(getVirtualRange(2, 3_300, 396, 33).firstVisible, 0);
  assert.equal(getVirtualRange(0, 300, 396, 33).end, 0);
  assert.equal(getVirtualRange(100, -300, 396, 33).start, 0);
  assert.throws(() => getVirtualRange(100, 0, 100, 0), /positive/);
});

test("indexes 10,000 nested nodes without recursion or stack overflow", () => {
  const deepNodes: TreeNode[] = Array.from({ length: 10_000 }, (_, index) => ({
    id: `node-${index}`,
    label: "Node",
    parentId: index === 0 ? undefined : `node-${index - 1}`,
  }));
  const rows = getTreeRows(deepNodes);
  assert.equal(rows[9999].depth, 9999);
  assert.equal(rows[0].subtreeEnd, 10_000);
  const visibleRows = rows.slice(6000, 6012);
  const indentation = getIndentation(visibleRows, 400);
  assert.equal(indentation.baseDepth, 5998);
  for (const row of visibleRows)
    assert.ok(getNodeOffset(row.depth, indentation) <= 400 * 0.42 + 28);
  assert.ok(indentation.size < 24);
});

test("rebases on viewport ancestry and fits very narrow panes", () => {
  const rows = getTreeRows(nodes);
  assert.deepEqual(getIndentation([], 200), { baseDepth: 0, size: 20 });
  assert.equal(getIndentation(rows, 600).baseDepth, 0);
  const indentation = getIndentation(rows, 40);
  assert.ok(getNodeOffset(2, indentation) <= 45);
  assert.equal(getIndentation(rows, 0).size, 0);
});
