import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("reassigned locals", () => {
  it("doesn't report a prop mutation when a handler reassigns a local holding the prop", () => {
    const project = analyzeFixture("conformance-repros", "reassigned-prop-local");
    expect(getWarningKinds(getComponent(project, "ResettableItems"))).toEqual([]);
  });
});
