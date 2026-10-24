import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a comparison whose sides fold on the initial values", () => {
  const project = analyzeFixture("conformance-repros", "relational-first-render");
  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.map((region) => region.firstRenderState);

  it("decides an offset on one side", () => {
    expect(getFirstRenders("NextPageCheck")).not.toContain(null);
  });

  it("decides a sum of two states", () => {
    expect(getFirstRenders("SumCompare")).not.toContain(null);
  });

  it("decides a ternary inside the comparison", () => {
    expect(getFirstRenders("TernaryInCompare")).not.toContain(null);
  });
});
