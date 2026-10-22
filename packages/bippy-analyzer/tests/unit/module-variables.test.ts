import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("state kept outside React", () => {
  const project = analyzeFixture("conformance-repros", "module-variables");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state) =>
      state.transitions.flatMap((transition) =>
        transition.targets.map((target) => [
          state.conditions.join(" && "),
          states[target]?.conditions.join(" && "),
        ]),
      ),
    );
  };

  it("starts a module variable from its declared value", () => {
    const { report } = getComponent(project, "ModuleCounter");
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual([
      "!(clicks > 0)",
    ]);
  });

  it("shows a handler's write to a module variable on the next render", () => {
    expect(getEdges("ModuleCounter")).toContainEqual(["!(clicks > 0)", "clicks > 0"]);
  });

  it("lets a handler that writes module state change an external store", () => {
    expect(getEdges("ExternalToggle")).toContainEqual(["!on", "on"]);
    expect(getEdges("ExternalToggle")).toContainEqual(["on", "!on"]);
  });
});
