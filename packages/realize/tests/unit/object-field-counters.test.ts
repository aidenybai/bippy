import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a number field of an object state", () => {
  const project = analyzeFixture("conformance-repros", "object-field-counters");

  const getEdges = (name: string) =>
    getComponent(project, name)
      .report.states.flatMap((state, stateIndex) =>
        state.transitions.flatMap((transition) =>
          transition.targets
            .filter((target) => target !== stateIndex)
            .map((target) => `${stateIndex}>${target}`),
        ),
      )
      .toSorted();

  it("counts up one state at a time and resets to zero", () => {
    expect(getEdges("FieldCounter")).toEqual(["0>1", "1>0", "1>2", "2>0", "2>1"]);
  });

  it("keeps the count when an updater changes another field", () => {
    expect(getEdges("SpreadFieldCounter")).toEqual(["0>1", "1>2", "2>1"]);
  });

  it("counts through a reducer that spreads the previous state", () => {
    expect(getEdges("ReducerFieldCounter")).toEqual(getEdges("FieldCounter"));
  });

  it("applies two queued updaters in one click", () => {
    expect(getEdges("DoubleFieldUpdater")).toEqual(["0>2", "1>2"]);
  });

  it("keeps the count when a later stale object write replaces an increment", () => {
    const { states } = getComponent(project, "StaleFieldWrites").report;
    const noneIndex = states.findIndex((state) => state.conditions.includes("state.count === 0"));
    const someIndex = states.findIndex((state) => state.conditions.includes("state.count !== 0"));
    expect(getEdges("StaleFieldWrites")).not.toContain(`${noneIndex}>${someIndex}`);
  });
});
