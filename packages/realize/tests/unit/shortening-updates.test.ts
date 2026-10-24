import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("updates that can only shorten a list", () => {
  const project = analyzeFixture("conformance-repros", "shortening-updates");

  it("never make it longer than it has been", () => {
    const { report } = getComponent(project, "SlicedList");
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never list.length > 1",
    ]);
  });
});
