import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("length of a string literal", () => {
  const project = analyzeFixture("conformance-repros", "literal-length");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.flatMap((state) => state.conditions);

  it("reads the empty fallback as a length of 0", () => {
    expect(getConditions("EmptyLength")).toContain("(input != null ? input.length : 0) > 0");
  });

  it("reads each literal as its own length", () => {
    expect(getConditions("FixedLength")).toContain("(isWide ? 4 : 0) === 4");
  });
});
