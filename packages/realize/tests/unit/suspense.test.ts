import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("Suspense", () => {
  const project = analyzeFixture("conformance-repros", "suspense-fallback");

  it("predicts the fallback and the children as separate states", () => {
    const panel = getComponent(project, "LazyPanel");
    expect(getBinding(panel, "suspended").kind).toBe("suspense");
    expect(panel.report.states.map((state) => state.conditions)).toEqual([
      ["suspended"],
      ["!suspended"],
    ]);
  });

  it("recognizes Suspense imported under another name", () => {
    const panel = getComponent(project, "AliasedLazyPanel");
    expect(getBinding(panel, "suspended").kind).toBe("suspense");
  });

  it("can suspend again and resolve after the first render", () => {
    const { states } = getComponent(project, "PagedPanel").report;
    const suspended = states.findIndex((state) => state.conditions.includes("suspended"));
    const shown = states.findIndex((state) => state.conditions.includes("!suspended"));
    const getTargets = (index: number) =>
      states[index]?.transitions.flatMap((transition) => transition.targets);
    expect(getTargets(shown)).toContain(suspended);
    expect(getTargets(suspended)).toContain(shown);
  });
});
