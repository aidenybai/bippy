import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state initialized to an object literal", () => {
  const project = analyzeFixture("conformance-repros", "object-initial-nullness");

  const getVerdicts = (name: string) =>
    getComponent(project, name).report.claimOutcomes.map(
      (outcome) => `${outcome.verdict} ${outcome.claim.description}`,
    );

  it.each(["NeverNullUser", "RenamedUser"])(
    "%s is never nullish when nothing sets it to null",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.states).toHaveLength(1);
      expect(report.regions[0]?.firstRenderState).toBe(0);
      expect(getVerdicts(name)).toEqual(["holds user!"]);
    },
  );

  it("starts non-null when a handler can clear it", () => {
    const { report } = getComponent(project, "ClearedUser");
    const firstRender = report.regions[0]?.firstRenderState ?? -1;
    expect(report.states[firstRender]?.conditions).toEqual(["user !== null"]);
  });
});
