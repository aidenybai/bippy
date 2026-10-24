import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("fields of an object state", () => {
  const project = analyzeFixture("conformance-repros", "object-state-fields");

  it.fails("keeps fields that every update writes together in one region", () => {
    const { report } = getComponent(project, "PairState");
    expect(report.regions).toHaveLength(1);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["state.isOpen", "state.step === 1"],
      ["!state.isOpen", "state.step !== 1"],
    ]);
  });

  it.fails("rules out a combination of fields no update writes", () => {
    const { report } = getComponent(project, "MovingFields");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['!(state.mode === "b" && state.count === 0)'],
    ]);
  });
});
