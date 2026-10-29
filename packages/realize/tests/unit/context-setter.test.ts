import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent, getFixtureConfig } from "./helpers";

describe("context setters", () => {
  const project = analyzeFixture("conformance-repros", "context-setter");
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

  it("samples the value a consumer reads, keyed by the file the context is declared in", () => {
    const contextKey = getFixtureConfig("conformance-repros").replace(
      "tsconfig.json",
      "src/hooks/picker-context.tsx#PickerContext",
    );
    expect(toggle.analysis.contextSamples.get(contextKey)).toEqual({
      kind: "Object",
      fields: {
        isPickerOpen: { kind: "Value", value: false },
        setIsPickerOpen: { kind: "Function", returns: { kind: "Undefined" } },
      },
      isOpen: false,
    });
  });
});
