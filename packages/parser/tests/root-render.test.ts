import { describe, expect, it } from "vite-plus/test";
import { RootRenderState } from "../src/evaluate/root-render.js";
import { UNDEFINED_VALUE, objectFromRecord, primitiveValue } from "../src/evaluate/values.js";

const app = primitiveValue("app");
const overlay = primitiveValue("overlay");
const loading = primitiveValue("loading");

describe("RootRenderState", () => {
  it("keeps one element per root in creation order, the last render winning", () => {
    const state = new RootRenderState();
    const overlayRoot = state.createRoot(objectFromRecord({}), null);
    const appRoot = state.createRoot(objectFromRecord({}), null);
    state.render(appRoot, loading);
    state.render(overlayRoot, overlay);
    state.render(appRoot, app);
    expect(state.elements).toEqual([overlay, app]);
  });

  it("skips roots never rendered into and reuses the root attached to a container", () => {
    const state = new RootRenderState();
    const container = objectFromRecord({});
    const rootId = state.createRoot(container, null);
    expect(state.elements).toEqual([]);
    expect(state.findRoot(container)).toBe(rootId);
    expect(state.findRoot(objectFromRecord({}))).toBeNull();
  });

  it("gives forked paths the same root id and joins their elements into a branch", () => {
    const state = new RootRenderState();
    const before = state.capture();
    const leftRoot = state.createRoot(objectFromRecord({}), app);
    const left = state.capture();
    state.restore(before);
    const rightRoot = state.createRoot(objectFromRecord({}), overlay);
    expect(rightRoot).toBe(leftRoot);
    state.join([left, state.capture()], "host global", null, 0, "truthy(flag)");
    const [joined] = state.elements;
    expect(joined).toMatchObject({
      kind: "branch",
      alternatives: [app, overlay],
      predicate: "truthy(flag)",
    });
  });

  it("renders nothing on the paths that did not open a root", () => {
    const state = new RootRenderState();
    state.createRoot(objectFromRecord({}), app);
    const withoutOverlay = state.capture();
    state.createRoot(objectFromRecord({}), overlay);
    state.join([withoutOverlay, state.capture()], "host global", null, 0, null);
    expect(state.elements).toEqual([
      app,
      expect.objectContaining({ kind: "branch", alternatives: [UNDEFINED_VALUE, overlay] }),
    ]);
  });
});
