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

  it("still lets a later read in the handler see the mutation", () => {
    const { states } = getComponent(project, "PushThenRead").report;
    const none = states.findIndex((state) => state.conditions.includes("items.length !== 1"));
    expect(states[0]?.transitions.flatMap((transition) => transition.targets)).toContain(none);
  });

  it("lets another handler read the pending mutation", () => {
    const { states } = getComponent(project, "QuietThenOtherRead").report;
    const none = states.findIndex((state) => state.conditions.includes("items.length !== 1"));
    expect(states[0]?.transitions.flatMap((transition) => transition.targets)).toContain(none);
  });
});
