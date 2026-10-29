import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("store actions", () => {
  const project = analyzeFixture("conformance-repros", "store-actions");
  const toggle = getComponent(project, "ThemeToggle");
  const updates = toggle.analysis.handlers.map((handler) =>
    handler.updates.map((update) => formatSymbolicValue(update.value)),
  );

  it("reads every selector of one store as a field of one binding", () => {
    expect(toggle.analysis.bindings.map((binding) => binding.name)).toEqual(["useConfig()"]);
  });

  it("sets the fields an action assigns, from its arguments or the previous state", () => {
    expect(updates).toEqual([
      ["{ ...useConfig(), darkmodeEnabled: !useConfig().darkmodeEnabled }"],
      ["{ ...useConfig(), rulersEnabled: !useConfig().rulersEnabled }"],
      ["{ ...useConfig(), darkmodeEnabled: Unknown(store), rulersEnabled: Unknown(store) }"],
    ]);
  });
});
