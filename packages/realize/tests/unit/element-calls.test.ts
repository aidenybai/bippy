import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getHandlerProbeId } from "./helpers";

describe("an element made by a createElement or jsx() call", () => {
  const project = analyzeFixture("conformance-repros", "element-calls");

  it.each(["CreateElementToggle", "JsxRuntimeToggle"])(
    "%s keeps its handler and the states its children split",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions)).toEqual([["on"], ["!on"]]);
      expect(report.states.map((state) => state.transitions.map((t) => t.targets))).toEqual([
        [[1]],
        [[0]],
      ]);
    },
  );

  it.each(["CreateElementToggle", "JsxRuntimeToggle"])(
    "%s probes the handler function, not the whole call",
    (name) => {
      expect(getHandlerProbeId(getComponent(project, name), "() => setOn(!on)")).toBeTruthy();
    },
  );

  it("links a component type to its declaration", () => {
    const parent = getComponent(project, "CreateElementParent");
    expect(parent.links.map((link) => link.child.split("#").at(-1))).toEqual(["Badge"]);
  });
});
