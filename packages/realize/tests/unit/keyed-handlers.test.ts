import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers chosen by a computed key", () => {
  const project = analyzeFixture("conformance-repros", "keyed-handlers");

  it("keeps a handler picked from an object literal by a conditional key", () => {
    const { analysis, report } = getComponent(project, "KeyedHandler");
    expect(
      analysis.handlers.map((handler) => handler.updates.map((update) => update.binding.name)),
    ).toEqual([["isArmed"], ["isDone"]]);
    expect(report.states.map((state) => state.conditions)).toEqual([["isDone"], ["!isDone"]]);
  });
});
