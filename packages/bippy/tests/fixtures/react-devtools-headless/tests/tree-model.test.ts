import { describe, expect, it } from "vite-plus/test";
import { createTreeModel } from "../src/tree-model.js";
import type { TreeModel, TreeModelNode } from "../src/tree-model.js";

const getFlatUids = (model: TreeModel): string[] => model.getFlatTree().map((node) => node.uid);

const createNodes = (): TreeModelNode[] => [
  { children: ["parent", "sibling"], name: "Grandparent", parentUid: null, uid: "root" },
  {
    children: ["first", "second"],
    name: "Parent",
    ownerUid: "root",
    parentUid: "root",
    uid: "parent",
  },
  { children: [], name: "Child", ownerUid: "parent", parentUid: "parent", uid: "first" },
  {
    children: [],
    errorCount: 1,
    name: "Child",
    ownerUid: "parent",
    parentUid: "parent",
    uid: "second",
  },
  {
    children: ["grandchild"],
    name: "Sibling",
    ownerUid: "root",
    parentUid: "root",
    uid: "sibling",
    warningCount: 1,
  },
  {
    children: [],
    name: "Grandchild",
    ownerUid: "sibling",
    parentUid: "sibling",
    uid: "grandchild",
  },
];

describe("upstream TreeContext model behavior", () => {
  it("should select the next and previous elements in the tree", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "next" });
    expect(model.getState().inspectedUid).toBe("root");
    model.dispatch({ type: "previous" });
    expect(model.getState().inspectedUid).toBe("grandchild");
    model.dispatch({ type: "next" });
    expect(model.getState().inspectedUid).toBe("root");
  });

  it("should select child elements", () => {
    const nodes = createNodes();
    nodes[1].isCollapsed = true;
    const model = createTreeModel(nodes);
    model.dispatch({ type: "select-uid", uid: "parent" });
    model.dispatch({ type: "select-child" });
    expect(getFlatUids(model)).toContain("first");
    expect(model.getState().inspectedUid).toBe("first");
  });

  it("should select parent elements and then collapse", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-uid", uid: "first" });
    model.dispatch({ type: "select-parent" });
    expect(model.getState().inspectedUid).toBe("parent");
    model.dispatch({ type: "select-parent" });
    expect(getFlatUids(model)).not.toContain("first");
    expect(model.getState().inspectedUid).toBe("parent");
  });

  it("does not mutate caller-owned nodes while selecting", () => {
    const nodes = createNodes();
    nodes[0].isCollapsed = true;
    nodes[1].isCollapsed = true;
    nodes[2].isHidden = true;
    const model = createTreeModel(nodes);
    model.dispatch({ type: "select-uid", uid: "first" });
    model.dispatch({ type: "select-child" });
    model.dispatch({ type: "select-parent" });
    expect(nodes[0].isCollapsed).toBe(true);
    expect(nodes[1].isCollapsed).toBe(true);
    expect(nodes[2].isHidden).toBe(true);
    expect(getFlatUids(model)).toContain("first");
  });

  it("should clear selection if the selected element is unmounted", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-uid", uid: "first" });
    model.setNodes(createNodes().filter((node) => node.uid !== "first"));
    expect(model.getState().inspectedUid).toBe("parent");
  });

  it("should navigate next/previous sibling and skip over children in between", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-uid", uid: "parent" });
    model.dispatch({ type: "next-sibling" });
    expect(model.getState().inspectedUid).toBe("sibling");
    model.dispatch({ type: "previous-sibling" });
    expect(model.getState().inspectedUid).toBe("parent");
  });

  it("should navigate the owner hierarchy", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-owner", uid: "root" });
    model.dispatch({ type: "next-owner" });
    expect(model.getState().inspectedUid).toBe("parent");
    model.dispatch({ type: "previous-owner" });
    expect(model.getState().inspectedUid).toBe("root");
  });

  it("should find elements matching search text", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "child", type: "set-search" });
    expect(model.getState().searchResults).toEqual(["first", "second", "grandchild"]);
    expect(model.getState().inspectedUid).toBe("first");
  });

  it("should select the next and previous items within the search results", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "child", type: "set-search" });
    model.dispatch({ type: "previous-search" });
    expect(model.getState().inspectedUid).toBe("grandchild");
    model.dispatch({ type: "next-search" });
    expect(model.getState().inspectedUid).toBe("first");
  });

  it("should jump directly to a specific search result by index", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "child", type: "set-search" });
    model.dispatch({ index: 1, type: "select-search-index" });
    expect(model.getState().inspectedUid).toBe("second");
    model.dispatch({ index: 100, type: "select-search-index" });
    expect(model.getState().inspectedUid).toBe("second");
  });

  it("should do nothing when jumping to a result with no search matches", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "missing", type: "set-search" });
    model.dispatch({ index: 1, type: "select-search-index" });
    expect(model.getState().inspectedUid).toBeNull();
  });

  it("should advance past the selected result when retyping the same search", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "child", type: "set-search" });
    model.dispatch({ text: "child", type: "set-search" });
    expect(model.getState().inspectedUid).toBe("second");
  });

  it("should add newly mounted elements to the search results set if they match the current text", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "new", type: "set-search" });
    const nextNodes = createNodes();
    nextNodes.push({ children: [], name: "New", parentUid: "root", uid: "new" });
    nextNodes[0].children.unshift("new");
    model.setNodes(nextNodes);
    expect(model.getState().searchResults).toEqual(["new"]);
    model.setNodes(createNodes());
    expect(model.getState().searchResults).toEqual([]);
  });

  it("should remove unmounted elements from the search results set", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ text: "child", type: "set-search" });
    model.setNodes(createNodes().filter((node) => node.uid !== "first"));
    expect(model.getState().searchResults).toEqual(["second", "grandchild"]);
  });

  it("should support entering and existing the owners tree view", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-owner", uid: "parent" });
    expect(model.getOwnerTree().map((node) => node.uid)).toEqual(["parent", "first", "second"]);
    model.dispatch({ type: "next-owner" });
    expect(model.getState().inspectedUid).toBe("first");
    model.dispatch({ type: "clear-owner" });
    expect(model.getState().ownerUid).toBeNull();
  });

  it("should remove an element from the owners list if it is unmounted", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-owner", uid: "parent" });
    model.setNodes(createNodes().filter((node) => node.uid !== "parent"));
    expect(model.getState().ownerUid).toBeNull();
    model.dispatch({ type: "select-owner", uid: "root" });
    model.dispatch({ type: "select-uid", uid: "sibling" });
    expect(model.getState().ownerUid).toBeNull();
  });

  it("should exit the owners list if the current owner is unmounted", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-owner", uid: "parent" });
    model.setNodes(createNodes().filter((node) => node.uid !== "parent"));
    expect(model.getState().ownerUid).toBeNull();
  });

  it("should exit the owners list if an element outside the list is selected", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "select-owner", uid: "parent" });
    model.dispatch({ type: "select-uid", uid: "sibling" });
    expect(model.getState().ownerUid).toBeNull();
  });

  it("cycles through errors and warnings across the tree", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("second");
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("sibling");
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("second");
    model.dispatch({ type: "previous-error" });
    expect(model.getState().inspectedUid).toBe("sibling");
  });

  it("tracks Activity selection independently", () => {
    const model = createTreeModel(createNodes());
    model.dispatch({ type: "set-activity", uid: "sibling" });
    expect(model.getState().activityUid).toBe("sibling");
    expect(model.getState().inspectedUid).toBeNull();
  });

  it("is included in the tree", () => {
    const nodes = createNodes();
    nodes[1].key = "React.optimisticKey";
    const model = createTreeModel(nodes);
    expect(model.getFlatTree().find((node) => node.uid === "parent")?.key).toBe(
      "React.optimisticKey",
    );
  });

  it("is searchable", () => {
    const nodes = createNodes();
    nodes[1].key = "React.optimisticKey";
    const model = createTreeModel(nodes);
    model.dispatch({ text: "optimistic", type: "set-search" });
    expect(model.getState().searchResults).toEqual(["parent"]);
    model.dispatch({ text: "react", type: "set-search" });
    expect(model.getState().inspectedUid).toBe("parent");
  });
});
