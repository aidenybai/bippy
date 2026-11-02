import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("baseUrl", () => {
  const project = analyzeFixture("base-url");

  it("resolves bare imports through baseUrl", () => {
    const nav = getComponent(project, "Nav");
    expect(getBinding(nav, "item").domain).toEqual({
      kind: "Cases",
      cases: [{ kind: "Type", text: "NavItem", primitive: null, isArrayLike: false }],
      origin: "type",
    });
    expect(nav.analysis.bailouts).toEqual([]);
  });
});
