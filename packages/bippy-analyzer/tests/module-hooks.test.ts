import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("hooks from one module", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "redux-drawer");

  it("changes what every hook from a module returns when a handler calls into one", () => {
    const [handler] = getComponent(project, "DrawerToggle").analysis.handlers;
    expect(handler?.updates.map((update) => update.binding.name).toSorted()).toEqual([
      "dispatch",
      "isOpen",
    ]);
  });
});
