import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

const getUnreachableBranches = async (
  fixture: string,
  file: string,
  name: string,
): Promise<string[]> =>
  getComponent(await analyzeFixture(fixture, file), name)
    .model.findings.filter((finding) => finding.kind === "unreachable-branch")
    .map((finding) => finding.message);

describe("branch evaluations", () => {
  it("counts a test the render decides on some paths", async () => {
    expect(
      await getUnreachableBranches("conformance-repros", "implicit-return", "BangPath"),
    ).toEqual([]);
  });

  it("counts a test the render evaluates outside the branch that shows it", async () => {
    expect(
      await getUnreachableBranches("conformance-repros", "guarded-ternary", "DateRangeLabel"),
    ).toEqual([]);
  });
});
