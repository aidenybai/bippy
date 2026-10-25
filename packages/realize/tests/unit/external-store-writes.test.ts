import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler that may write an external store", () => {
  const project = analyzeFixture("conformance-repros", "external-store-writes");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== index)
          .map((target) => [
            state.conditions.join(" && "),
            states[target]?.conditions.join(" && "),
          ]),
      ),
    );
  };

  it.each(["ModuleStore", "DeclaredStore"])("%s may change the store's snapshot", (name) => {
    expect(getEdges(name)).toEqual([
      ["value === 1", "value !== 1"],
      ["value !== 1", "value === 1"],
    ]);
  });
});
