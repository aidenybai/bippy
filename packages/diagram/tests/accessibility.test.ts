import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeKeyAction, getTreeDescriptions } from "../src/diagram/accessibility";
import { getTreeRows, type TreeNode } from "../src/diagram/tree-model";
import { getVisibleTreeRows } from "../src/diagram/tree-visible-rows";
import { getTreeLayout } from "../src/diagram/tree-layout";
import { getTreeHighlightIndex } from "../src/diagram/tree-highlight";

const nodes: TreeNode[] = [
  { id: "root", label: "Root", kind: "boundary" },
  { id: "branch", label: "Branch", parentId: "root", ownerId: "root" },
  { id: "detail", label: "useState", componentId: "branch", parentId: "branch", kind: "hook" },
  { id: "leaf", label: "Leaf", parentId: "branch" },
  { id: "sibling", label: "Sibling", parentId: "root" },
];
const rows = getTreeRows(nodes);
const expanded = new Set<string>();

test("tree navigation separates focus, expansion, and activation", () => {
  assert.deepEqual(getTreeKeyAction(rows, "root", "ArrowDown", expanded), { focusId: "branch" });
  assert.deepEqual(getTreeKeyAction(rows, "branch", "ArrowRight", expanded), { focusId: "detail" });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "ArrowLeft", expanded), { focusId: "branch" });
  assert.deepEqual(getTreeKeyAction(rows, "branch", "ArrowLeft", expanded), { toggleId: "branch" });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "Enter", expanded), { activate: true });
  assert.deepEqual(getTreeKeyAction(rows, "detail", " ", expanded), { activate: true });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "Escape", expanded), { clear: true });
});

test("tree navigation handles boundaries, empty input, and RTL", () => {
  assert.deepEqual(getTreeKeyAction(rows, "root", "ArrowUp", expanded), { focusId: "root" });
  assert.deepEqual(getTreeKeyAction(rows, "sibling", "ArrowDown", expanded), {
    focusId: "sibling",
  });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "Home", expanded), { focusId: "root" });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "End", expanded), { focusId: "sibling" });
  assert.deepEqual(getTreeKeyAction(rows, "branch", "ArrowLeft", new Set(["branch"]), "rtl"), {
    toggleId: "branch",
  });
  assert.deepEqual(getTreeKeyAction(rows, "detail", "ArrowRight", expanded, "rtl"), {
    focusId: "branch",
  });
  assert.equal(getTreeKeyAction([], null, "ArrowDown", expanded), undefined);
});

test("collapsed projections reindex geometry and catch ranges without losing sibling semantics", () => {
  const visible = getVisibleTreeRows(rows, new Set(["branch"]));
  assert.deepEqual(
    visible.map((row) => row.node.id),
    ["root", "branch", "sibling"],
  );
  assert.equal(visible[1].hasChildren, true);
  assert.equal(visible[2].parentIndex, 0);
  assert.equal(visible[2].position, 2);
  assert.equal(visible[2].siblingCount, 2);
  assert.deepEqual(getTreeLayout(visible).offsets, [0, 24, 48, 72]);
  assert.deepEqual(getTreeHighlightIndex(visible).catchRanges.get("root"), [{ start: 1, end: 3 }]);
  assert.equal(getVisibleTreeRows(rows, expanded), rows);
});

test("screen-reader descriptions explain metadata, ownership, and directed relationships", () => {
  const descriptions = getTreeDescriptions(nodes, [
    { from: "detail", to: "leaf", kind: "data", label: "renders" },
  ]);
  assert.match(
    descriptions.get("detail") ?? "",
    /Component detail: hook\. Details of Branch\. Outgoing renders: Leaf\./,
  );
  assert.match(descriptions.get("leaf") ?? "", /Incoming renders: Branch: useState\./);
  assert.match(descriptions.get("branch") ?? "", /Parent: Root\. Owner: Root\./);
  assert.match(descriptions.get("root") ?? "", /excluding errors handled inside nested boundaries/);
});
