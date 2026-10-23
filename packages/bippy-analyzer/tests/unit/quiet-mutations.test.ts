import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("a mutation no handler re-renders", () => {
  const project = analyzeFixture("conformance-repros", "quiet-mutations");

  it("never shows, so the first state is the only one", () => {
    const component = getComponent(project, "SameReferenceSet");
    expect(component.report.states.map((state) => state.conditions)).toEqual([[]]);
    expect(getWarningKinds(component)).toEqual(["lost-update", "state-mutation"]);
  });
});
