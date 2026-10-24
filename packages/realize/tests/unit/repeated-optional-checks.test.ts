import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("optional chains checked twice", () => {
  const project = analyzeFixture("conformance-repros", "repeated-optional-checks");

  it("keeps a field's narrowing when the other case left its object nullish", () => {
    const { report } = getComponent(project, "DialogBar");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['dialog?.name === "link"'],
      ['dialog?.name !== "link"', 'dialog?.name !== "link"'],
    ]);
  });
});
