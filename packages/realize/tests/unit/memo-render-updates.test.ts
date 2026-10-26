import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state update inside a useMemo callback", () => {
  const project = analyzeFixture("conformance-repros", "memo-render-updates");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("keeps the renders on both sides of a try", () => {
    const conditions = getConditions("ParsedInput").flat();
    expect(conditions).toContain("Unknown(throws)");
    expect(conditions).toContain("!Unknown(throws)");
  });

  it("keeps the render where the memo's update fires", () => {
    expect(getConditions("SeenLabel")).toContainEqual(["text"]);
  });
});
