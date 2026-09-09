import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { createCommitRecorder, getRootContainer } from "../src/harness/index.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import { BranchMarker, MARKER_NAMES } from "../src/materialize/markers.js";

const LONG_TEXT = "x".repeat(500);

const findFiber = (
  fiber: RuntimeFiberSnapshot,
  name: string,
): RuntimeFiberSnapshot | undefined =>
  fiber.name === name
    ? fiber
    : fiber.children.map((child) => findFiber(child, name)).find((found) => found);

const snapshotTree = async (tree: ReactElement): Promise<RuntimeFiberSnapshot> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  const root = createRoot(container);
  try {
    await act(async () => root.render(tree));
    const [rootFiber] = recorder.snapshot().roots;
    if (!rootFiber) throw new Error("nothing committed");
    return rootFiber;
  } finally {
    await act(async () => root.unmount());
    recorder.dispose();
    container.remove();
  }
};

describe("runtime snapshot props", () => {
  it("abbreviates long host props but keeps a marker's decision identity verbatim", async () => {
    const tree = await snapshotTree(
      createElement(
        BranchMarker,
        { reason: "test", location: null, preferredIndex: 0, predicate: LONG_TEXT },
        createElement("div", { title: LONG_TEXT }),
      ),
    );
    expect(findFiber(tree, MARKER_NAMES.branch)?.props.predicate).toBe(LONG_TEXT);
    const title = findFiber(tree, "div")?.props.title;
    expect(typeof title).toBe("string");
    expect(title).not.toBe(LONG_TEXT);
    expect(String(title).endsWith("…")).toBe(true);
  });
});
