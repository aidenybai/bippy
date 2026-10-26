import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter handed straight to an external hook", () => {
  const project = analyzeFixture("conformance-repros", "hook-setter-callbacks");

  it.each(["SelectionCount", "SelectionDispatch"])("lets %s's hook change the state", (name) => {
    const { analysis, report } = getComponent(project, name);
    expect(analysis.handlers.map((handler) => handler.trigger)).toMatchObject([
      { kind: "Effect", hookKind: "Custom" },
    ]);
    expect(
      report.states.map((state) => state.transitions.map((transition) => transition.targets)),
    ).toEqual([[[0, 1]], [[0, 1]]]);
  });
});
