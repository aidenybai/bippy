import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an effect with an empty dependency list", () => {
  const project = analyzeFixture("conformance-repros", "empty-effect-dependencies");

  const isCleanedReachable = (name: string): boolean =>
    getComponent(project, name).report.states.some((state) => state.conditions.includes("cleaned"));

  it.each(["AssertedDependencies", "CommentedDependencies"])(
    "never runs the %s cleanup while mounted",
    (name) => {
      expect(isCleanedReachable(name)).toBe(false);
    },
  );

  it("runs the cleanup when a listed dependency changes", () => {
    expect(isCleanedReachable("CountDependencies")).toBe(true);
  });
});
