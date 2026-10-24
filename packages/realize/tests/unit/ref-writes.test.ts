import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a ref written in a handler", () => {
  const project = analyzeFixture("conformance-repros", "ref-writes");

  const getFirstConditions = (name: string) => {
    const { report } = getComponent(project, name);
    return report.regions.map((region) =>
      region.firstRenderState === null ? null : report.states[region.firstRenderState]?.conditions,
    );
  };

  const getEdges = (name: string) => {
    const component = getComponent(project, name);
    const { states } = component.report;
    return states.flatMap((state) =>
      state.transitions.flatMap((transition) =>
        transition.targets.map((target) => [
          state.conditions.join(" && "),
          states[target]?.conditions.join(" && "),
        ]),
      ),
    );
  };

  it("starts from the value passed to useRef", () => {
    expect(getFirstConditions("RefFlag")).toEqual([["!open.current"]]);
  });

  it("shows the write on the render that follows", () => {
    expect(getEdges("RefFlag")).toContainEqual(["!open.current", "open.current"]);
    expect(getEdges("RefWithoutRender")).toContainEqual(["!open.current", "open.current"]);
  });

  it("leaves the first render open when the render writes the ref", () => {
    expect(getFirstConditions("LazyRef")).toEqual([null]);
  });
});
