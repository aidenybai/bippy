import { describe, expect, it } from "vite-plus/test";
import { getBindingPlace } from "../../src/core/utils/place";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("narrowing cast", () => {
  it("claims no values for state set from a cast to a literal union", () => {
    const project = analyzeFixture("conformance-repros", "narrowing-cast");
    const component = getComponent(project, "LanguagePicker");
    const language = getBinding(component, "language");
    expect(component.report.places.get(getBindingPlace(language))).toBeUndefined();
  });
});
