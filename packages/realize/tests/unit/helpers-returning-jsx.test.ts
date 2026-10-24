import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("helpers that return JSX", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "helpers.tsx"),
    "FileRow",
  );

  it("are followed whether they live in the file or another file", () => {
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.renders).toEqual([]);
  });

  it("contribute their branches to the states", () => {
    const conditions = report.states.map((state) => state.conditions.join(" ∧ "));
    expect(conditions).toEqual([
      expect.stringContaining('path.endsWith(".ts")'),
      expect.stringContaining('!path.endsWith(".ts")'),
      expect.stringContaining("opened > 0"),
      expect.stringContaining("opened <= 0"),
    ]);
  });
});
