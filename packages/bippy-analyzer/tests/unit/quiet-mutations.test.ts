import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("a mutation no handler re-renders", () => {
  const project = analyzeFixture("conformance-repros", "quiet-mutations");

  it("never shows, so the first state is the only one", () => {
    const component = getComponent(project, "SameReferenceSet");
    expect(component.report.states.map((state) => state.conditions)).toEqual([[]]);
    expect(getWarningKinds(component)).toEqual(["lost-update", "state-mutation"]);
  });

  it("still shows when the handler calls imported code that might re-render", () => {
    const { states } = getComponent(project, "NotifyAfterPush").report;
    expect(states.flatMap((state) => state.transitions)).not.toEqual([]);
  });
});
