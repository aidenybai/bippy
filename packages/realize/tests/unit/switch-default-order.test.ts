import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a switch", () => {
  const project = analyzeFixture("conformance-repros", "switch-default-order");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("tests every case before a default written in the middle", () => {
    expect(getTargets("DefaultMiddle")).toEqual([
      [[2], [1]],
      [[2], [1]],
      [[2], [1]],
    ]);
  });

  it("skips a default written first when a later case matches", () => {
    expect(getComponent(project, "DefaultFirstFallsThrough").report.states).toHaveLength(2);
    expect(getTargets("DefaultFirstFallsThrough")).toEqual([[[1]], [[1]]]);
  });

  it("keeps a value written before a case falls through", () => {
    const { report } = getComponent(project, "CaseFallsThrough");
    expect(report.states).toHaveLength(2);
    expect(report.states[0]?.conditions[0]).toContain('mode === "a" ? true');
  });

  it("records the update of a case after a default in a handler", () => {
    const { analysis } = getComponent(project, "HandlerDefaultMiddle");
    expect(
      analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => formatSymbolicValue(update.value)),
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("is unchanged when default is last", () => {
    expect(getTargets("DefaultLast")).toEqual([[[1]], [[1]]]);
  });
});
