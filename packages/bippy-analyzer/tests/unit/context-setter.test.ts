import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { formatSymbolicValue } from "../../src/core/format.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("context setters", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "context-setter");
  const toggle = getComponent(project, "PickerToggle");

  it("types a context read through a hook from another file", () => {
    const [context] = toggle.analysis.bindings;
    expect(context?.domain).toEqual({ kind: "Opaque", typeText: "PickerState" });
  });

  it("sets the field a provider pairs with the setter a consumer calls", () => {
    const [handler] = toggle.analysis.handlers;
    const [update] = handler?.updates ?? [];
    expect(update && formatSymbolicValue(update.value)).toBe(
      "{ ...useContext(), isPickerOpen: !useContext().isPickerOpen }",
    );
    expect(update?.isAsync).toBe(true);
  });
});
