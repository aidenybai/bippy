import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a copy of state another handler mutated in place", () => {
  const project = analyzeFixture("conformance-repros", "quiet-mutation-copies");
  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("can hold what was added to a Set before the copy", () => {
    expect(getConditions("QuietAddThenCopy")).toContainEqual(["ids.has(5)"]);
  });

  it("can be longer than the rendered list after a quiet push", () => {
    expect(getConditions("QuietPushThenSlice")).toContainEqual(["items.length > 1"]);
  });
});
