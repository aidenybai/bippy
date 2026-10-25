import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("pure calls inside a literal-value test, and enum objects", () => {
  const project = analyzeFixture("conformance-repros", "leftover-forms");

  const getUpdatedValues = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  it("decides Math.floor and Math.round over literal values", () => {
    const { states } = getComponent(project, "RoundedToggle").report;
    expect(states.map((state) => state.conditions)).toEqual([[]]);
  });

  it.each([
    ["EnumValues", "calm"],
    ["EnumCount", 2],
    ["EnumNames", "Idle"],
  ])("%s reads the enum object as %s", (name, value) => {
    expect(getUpdatedValues(name)).toEqual([{ kind: "Primitive", value }]);
  });
});
