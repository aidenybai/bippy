import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a field the initial object literal leaves out", () => {
  const project = analyzeFixture("conformance-repros", "missing-fields");

  it("is undefined on the first render", () => {
    const { report } = getComponent(project, "MissingField");
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual([
      "!box.extra",
    ]);
  });
});
