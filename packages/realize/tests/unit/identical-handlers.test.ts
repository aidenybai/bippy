import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers with identical effects", () => {
  const project = analyzeFixture("conformance-repros", "shared-shortcuts");

  it("keep one handler for a callback passed to two hook calls", () => {
    const { analysis, report } = getComponent(project, "SharedShortcut");
    expect(analysis.handlers.map((handler) => handler.trigger.kind)).toEqual(["Effect"]);
    expect(report.states.map((state) => state.transitions.length)).toEqual([1, 1]);
  });
});
