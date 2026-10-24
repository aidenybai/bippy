import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a string state a handler rewrites from itself", () => {
  const project = analyzeFixture("conformance-repros", "string-self-updates");

  it.each(["TrimmedText", "ReplacedText"])(
    "%s keeps to the lengths its known values have",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
        "never text.length !== 2",
      ]);
    },
  );
});
