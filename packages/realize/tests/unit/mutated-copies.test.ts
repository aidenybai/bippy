import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a copy of state pushed to before it is set", () => {
  const project = analyzeFixture("conformance-repros", "mutated-copies");
  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("can grow past the rendered length after slice", () => {
    expect(getConditions("SliceCopyPush")).toContainEqual(["items.length > 0"]);
  });

  it("can grow past the rendered length after filter", () => {
    expect(getConditions("FilterThenPush")).toContainEqual(["items.length > 0"]);
  });
});
