import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function kept in a ref", () => {
  const project = analyzeFixture("conformance-repros", "ref-mount-closures");

  const getReachable = (name: string, from: string) => {
    const { report } = getComponent(project, name);
    const source = report.states.find((state) => state.conditions.join(" ∧ ") === from);
    return (source?.transitions ?? []).flatMap((transition) =>
      transition.targets.map((target) => report.states[target]?.conditions.join(" ∧ ")),
    );
  };

  it("runs when read straight off useRef(fn).current", () => {
    expect(getReachable("RefActionDirect", "count !== 2 ∧ count !== 1")).toContain("count === 2");
  });

  it("reads the values of the render that made it, not the current ones", () => {
    expect(getReachable("RefActionCalled", "flag && count === 2")).toContain("flag && count === 2");
  });
});
