import assert from "node:assert/strict";
import { test } from "node:test";
import { getTreeRows } from "../src/diagram/tree-model";
import {
  getTreeHighlight,
  getTreeHighlightIndex,
  getOwnerNodes,
} from "../src/diagram/tree-highlight";
import { parentNodes } from "../src/board/fixtures";

const rows = getTreeRows(parentNodes);
const index = getTreeHighlightIndex(rows);
const getCaughtIds = (nodeId: string) =>
  getTreeHighlight(index, nodeId).catchRanges.flatMap((range) =>
    rows.slice(range.start, range.end).map((row) => row.node.id),
  );

test("boundaries catch their descendants, but not themselves or nested boundary contents", () => {
  assert.deepEqual(getCaughtIds("feed-error"), [
    "feed",
    "list",
    "post-1",
    "item-1",
    "post-2",
    "item-2",
  ]);
  const outer = getCaughtIds("error");
  assert.equal(outer.includes("error"), false);
  assert.equal(outer.includes("feed-error"), true);
  assert.equal(outer.includes("feed"), false);
  assert.equal(outer.includes("fragment"), true);
  assert.equal(outer.includes("button-2"), true);
  assert.equal(getTreeHighlight(index, "error").catchRanges.length, 2);
});

test("parent view emphasizes direct ownership; owner view follows the owner subtree", () => {
  const parent = getTreeHighlight(index, "app");
  const owner = getTreeHighlight(index, "app", "owner");
  assert.equal(parent.mode, "owner");
  assert.equal(parent.highlightedIds?.has("frame"), true);
  assert.equal(parent.highlightedIds?.has("div"), false);
  assert.equal(owner.highlightedIds?.has("div"), true);
  assert.equal(owner.highlightedIds?.has("strict"), false);
  assert.equal(getOwnerNodes(parentNodes).find((node) => node.id === "post-1")?.parentId, "app");
});

test("ownership traversal terminates on cycles and empty boundaries have no ranges", () => {
  const cycle = getTreeHighlightIndex(
    getTreeRows([
      { id: "first", label: "First", ownerId: "second" },
      { id: "second", label: "Second", ownerId: "first" },
      { id: "boundary", label: "Boundary", kind: "boundary" },
    ]),
  );
  assert.equal(getTreeHighlight(cycle, "first", "owner").highlightedIds?.size, 2);
  assert.deepEqual(getTreeHighlight(cycle, "boundary").catchRanges, []);
  assert.equal(getTreeHighlight(cycle, null).mode, "none");
});
