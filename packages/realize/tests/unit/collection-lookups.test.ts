import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a lookup in a literal table, Map or Set by a state key", () => {
  const project = analyzeFixture("conformance-repros", "collection-lookups");

  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.flatMap(
      (region) => region.possibleFirstRenderStates,
    );

  it.each([
    ["LocalMapLabel", [0]],
    ["ModuleMapLabel", [1]],
    ["SetMembership", [1]],
    ["TableLabel", [1]],
  ])("%s first renders the entry its initial key picks", (name, firstRenders) => {
    expect(getFirstRenders(name)).toEqual(firstRenders);
  });

  it("splits a Map's labels into their own states", () => {
    const { states } = getComponent(project, "LocalMapLabel").report;
    expect(states.map((state) => state.conditions)).toEqual([["count === 0"], ["count !== 0"]]);
  });
});
