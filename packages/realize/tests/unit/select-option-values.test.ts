import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a value a form control can report", () => {
  const project = analyzeFixture("conformance-repros", "select-option-values");

  it.each(["MappedSelect", "MappedOptions", "RadioPair"])(
    "keeps %s to the values its options allow",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions)).toEqual([
        ['pick === "a"'],
        ['pick !== "a"'],
      ]);
    },
  );
});
