import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an optional read of an object chosen on the first render", () => {
  const project = analyzeFixture("conformance-repros", "optional-object-reads");

  it.each([
    ["FindBySelected", [0]],
    ["SecondRow", [0]],
    ["LiteralIndex", [1]],
  ])("%s has the first render React shows", (name, firstRenders) => {
    const { report } = getComponent(project, name);
    expect(report.regions.flatMap((region) => region.possibleFirstRenderStates)).toEqual(
      firstRenders,
    );
  });
});
