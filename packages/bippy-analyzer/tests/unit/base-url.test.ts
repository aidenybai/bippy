import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("baseUrl", () => {
  const project = analyzeFixture("base-url");

  it("resolves bare imports through baseUrl", () => {
    const nav = getComponent(project, "Nav");
    expect(getBinding(nav, "item").domain).toEqual({ kind: "Opaque", typeText: "NavItem" });
    expect(nav.analysis.bailouts).toEqual([]);
  });
});
