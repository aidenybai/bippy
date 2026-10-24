import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a number state rewritten from itself", () => {
  const project = analyzeFixture("conformance-repros", "number-self-updates");
  const getUnreachable = (name: string) =>
    getComponent(project, name).report.unreachableBranches.map((branch) => branch.description);

  it("follows a pure function of its own value", () => {
    expect(getUnreachable("FloorSelf")).toContain("never n === 3");
  });

  it("keeps the range of a counter that never settles", () => {
    expect(getUnreachable("CounterSelf")).toContain("never n < 0");
  });
});
