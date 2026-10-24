import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an update guarded by a value its state never reaches", () => {
  const project = analyzeFixture("conformance-repros", "self-guarded-updates");

  it("doesn't add the guarded value to the state's reachable values", () => {
    const { report } = getComponent(project, "GuardedReset");
    expect(report.unreachableBranches.map((branch) => branch.description)).toContain(
      "never n === 0",
    );
  });
});
