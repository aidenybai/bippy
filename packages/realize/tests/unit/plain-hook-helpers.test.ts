import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a use-named project function that calls no hooks", () => {
  const project = analyzeFixture("conformance-repros", "plain-hook-helpers");

  it("runs a callback it returns in props only from the event that reads them", () => {
    const { analysis, report } = getComponent(project, "ReturnedRowProps");
    expect(analysis.handlers.map((handler) => handler.trigger.kind)).toEqual(["Event"]);
    expect(report.regions[0]?.firstRenderState).not.toBeNull();
  });

  it("never runs a callback whose result goes unused", () => {
    const { analysis, report } = getComponent(project, "UnusedRowProps");
    expect(analysis.handlers).toEqual([]);
    expect(report.states).toHaveLength(1);
  });

  it("still runs a callback it hands to a call it can't see into as an effect", () => {
    const { analysis } = getComponent(project, "SubscribedHelper");
    expect(analysis.handlers.map((handler) => handler.trigger.kind)).toEqual(["Effect"]);
  });
});
