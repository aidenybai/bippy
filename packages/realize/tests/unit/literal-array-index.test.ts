import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an index into a state's literal initial array", () => {
  const project = analyzeFixture("conformance-repros", "literal-array-index");
  const getFirstRenderConditions = (name: string) => {
    const { states, regions } = getComponent(project, name).report;
    return regions.map((region) =>
      region.firstRenderState === null ? null : states[region.firstRenderState]?.conditions,
    );
  };

  it("decides the first render from the element", () => {
    expect(getFirstRenderConditions("FirstItemCheck")).toEqual([["items.0 !== 9"]]);
  });

  it("reads a field of the element", () => {
    expect(getFirstRenderConditions("NestedRowFlag")).toEqual([["!rows.0.isOn"]]);
  });

  it("reads undefined past the end", () => {
    expect(getFirstRenderConditions("PastTheEnd")).toEqual([["items.1 === undefined"]]);
  });
});
