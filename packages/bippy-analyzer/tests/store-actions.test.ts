import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { formatSymbolicValue } from "../src/core/format.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("store actions", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "store-actions");
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
