import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter called from a row mapped behind an optional chain", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "mapped-rows.tsx"),
    "Picker",
  );

  it("is a handler on the row's button", () => {
    expect(analysis.handlers.map((handler) => handler.trigger)).toEqual([
      { kind: "Event", tag: "button", event: "onClick" },
    ]);
    expect(analysis.handlers[0]?.updates.map((update) => update.binding.name)).toEqual([
      "selected",
    ]);
  });

  it("moves the selection region through that button", () => {
    const selection = report.regions.find((region) => region.placeNames.includes("selected"));
    const states = selection?.states.map((index) => report.states[index]) ?? [];
    expect(states).toHaveLength(2);
    expect(states.every((state) => state?.transitions.length === 1)).toBe(true);
  });
});
