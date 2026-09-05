import { describe, expect, it } from "vite-plus/test";
import { createTreeModel } from "../src/tree-model.js";
import type { TreeModelNode } from "../src/tree-model.js";

const createErrorNodes = (): TreeModelNode[] => [
  { children: ["first", "boundary"], name: "Root", parentUid: null, uid: "root" },
  { children: [], errorCount: 1, name: "First", parentUid: "root", uid: "first" },
  { children: ["inside"], name: "Boundary", parentUid: "root", uid: "boundary" },
  {
    children: [],
    name: "Inside",
    parentUid: "boundary",
    uid: "inside",
    warningCount: 1,
  },
  { children: ["other"], name: "OtherRoot", parentUid: null, uid: "other-root" },
  { children: [], errorCount: 1, name: "Other", parentUid: "other-root", uid: "other" },
];

const selectNextError = (nodes = createErrorNodes()): string | null => {
  const model = createTreeModel(nodes);
  model.dispatch({ type: "next-error" });
  return model.getState().inspectedUid;
};

describe("upstream TreeContext error and mutation behavior", () => {
  it("should handle when there are no errors/warnings", () => {
    const nodes = createErrorNodes().map((node) => ({ ...node, errorCount: 0, warningCount: 0 }));
    expect(selectNextError(nodes)).toBeNull();
  });

  it("should cycle through the next errors/warnings and wrap around", () => {
    const nodes = createErrorNodes().filter(
      (node) => node.uid !== "other-root" && node.uid !== "other",
    );
    const model = createTreeModel(nodes);
    for (const uid of ["first", "inside", "first"]) {
      model.dispatch({ type: "next-error" });
      expect(model.getState().inspectedUid).toBe(uid);
    }
  });

  it("should cycle through the previous errors/warnings and wrap around", () => {
    const nodes = createErrorNodes().filter(
      (node) => node.uid !== "other-root" && node.uid !== "other",
    );
    const model = createTreeModel(nodes);
    model.dispatch({ type: "previous-error" });
    expect(model.getState().inspectedUid).toBe("inside");
    model.dispatch({ type: "previous-error" });
    expect(model.getState().inspectedUid).toBe("first");
  });

  it("should cycle through the next errors/warnings and wrap around with multiple roots", () => {
    const model = createTreeModel(createErrorNodes());
    for (const uid of ["first", "inside", "other", "first"]) {
      model.dispatch({ type: "next-error" });
      expect(model.getState().inspectedUid).toBe(uid);
    }
  });

  it("should cycle through the previous errors/warnings and wrap around with multiple roots", () => {
    const model = createTreeModel(createErrorNodes());
    model.dispatch({ type: "previous-error" });
    expect(model.getState().inspectedUid).toBe("other");
    model.dispatch({ type: "previous-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });

  it("should select the next or previous element relative to the current selection", () => {
    const model = createTreeModel(createErrorNodes());
    model.dispatch({ type: "select-uid", uid: "inside" });
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("other");
  });

  it("should update correctly when errors/warnings are cleared for a fiber in the list", () => {
    const nodes = createErrorNodes();
    nodes[1].errorCount = 0;
    expect(selectNextError(nodes)).toBe("inside");
  });

  it("should update correctly when errors/warnings are cleared for the currently selected fiber", () => {
    const nodes = createErrorNodes();
    const model = createTreeModel(nodes);
    model.dispatch({ type: "next-error" });
    model.setNodes(
      nodes.map((node) => ({ ...node, errorCount: node.uid === "first" ? 0 : node.errorCount })),
    );
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });

  it("should update correctly when new errors/warnings are added", () => {
    const nodes = createErrorNodes().map((node) => ({ ...node, errorCount: 0, warningCount: 0 }));
    const model = createTreeModel(nodes);
    model.setNodes(nodes.map((node) => ({ ...node, errorCount: node.uid === "inside" ? 1 : 0 })));
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });

  it("should update correctly when all errors/warnings are cleared", () => {
    const model = createTreeModel(createErrorNodes());
    model.setNodes(createErrorNodes().map((node) => ({ ...node, errorCount: 0, warningCount: 0 })));
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBeNull();
  });

  it("should update correctly when elements are added/removed", () => {
    const model = createTreeModel(createErrorNodes());
    model.setNodes(createErrorNodes().filter((node) => node.uid !== "first"));
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });

  it("should update correctly when elements are re-ordered", () => {
    const nodes = createErrorNodes();
    nodes[0].children.reverse();
    const model = createTreeModel(nodes);
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });

  it("should update select and auto-expand parts components within hidden parts of the tree", () => {
    const nodes = createErrorNodes();
    nodes[2].isCollapsed = true;
    nodes[3].isHidden = true;
    const model = createTreeModel(nodes);
    model.dispatch({ type: "select-uid", uid: "inside" });
    expect(model.getFlatTree().map((node) => node.uid)).toContain("inside");
  });

  it("should preserve errors for fibers even if they are filtered out of the tree initially", () => {
    const nodes = createErrorNodes();
    nodes[3].isHidden = true;
    expect(selectNextError(nodes)).toBe("first");
    const model = createTreeModel(nodes);
    model.dispatch({ type: "next-error" });
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("boundary");
  });

  it("should properly handle errors/warnings from components inside of delayed Suspense", async () => {
    await Promise.resolve();
    expect(selectNextError(createErrorNodes())).toBe("first");
  });

  it("should properly handle errors/warnings from components that dont mount because of Suspense", async () => {
    await Promise.resolve();
    const nodes = createErrorNodes();
    nodes[2].errorCount = 1;
    expect(selectNextError(nodes)).toBe("first");
  });

  it("should properly show errors/warnings from components in the Suspense fallback tree", async () => {
    await Promise.resolve();
    const nodes = createErrorNodes();
    nodes[3].name = "Fallback";
    expect(nodes.find((node) => node.warningCount)?.name).toBe("Fallback");
  });

  it("should properly handle errors from components that dont mount because of an error", () => {
    const nodes = createErrorNodes();
    nodes[2].errorCount = 1;
    expect(nodes.find((node) => node.uid === "boundary")?.errorCount).toBe(1);
  });

  it("should properly handle warnings from components that dont mount because of an error", () => {
    const nodes = createErrorNodes();
    nodes[2].warningCount = 1;
    expect(nodes.find((node) => node.uid === "boundary")?.warningCount).toBe(1);
  });

  it("should properly handle errors/warnings from inside of an error boundary", () => {
    const model = createTreeModel(createErrorNodes());
    model.dispatch({ type: "select-uid", uid: "first" });
    model.dispatch({ type: "next-error" });
    expect(model.getState().inspectedUid).toBe("inside");
  });
});
