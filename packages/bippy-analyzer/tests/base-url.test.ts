import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { getBinding, getComponent, getFixtureConfig } from "./helpers.js";

describe("baseUrl", () => {
  const project = analyzeProject(getFixtureConfig("base-url"));

  it("resolves bare imports through baseUrl", () => {
    const nav = getComponent(project, "Nav");
    expect(getBinding(nav, "item").domain).toEqual({ kind: "Opaque", typeText: "NavItem" });
    expect(nav.analysis.bailouts).toEqual([]);
  });
});
