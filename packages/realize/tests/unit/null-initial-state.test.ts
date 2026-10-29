import { describe, expect, it } from "vite-plus/test";
import { getBindingPlace } from "../../src/core/values/get-binding-place";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("null initial state", () => {
  it("claims no values for untyped state that starts null and gets set", () => {
    const project = analyzeFixture("conformance-repros", "null-initial-state");
    const component = getComponent(project, "CopySteps");
    const copiedStep = getBinding(component, "copiedStep");
    expect(component.report.places.get(getBindingPlace(copiedStep))).toBeUndefined();
  });
});
