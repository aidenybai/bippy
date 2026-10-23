import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a string state a handler rewrites from itself", () => {
  const project = analyzeFixture("conformance-repros", "string-self-updates");

  it("keeps to the lengths its known values have", () => {
    const { report } = getComponent(project, "TrimmedText");
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never text.length !== 2",
    ]);
  });
});
