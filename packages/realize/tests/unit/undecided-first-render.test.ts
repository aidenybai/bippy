import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a region whose first render the initial values can't decide", () => {
  const project = analyzeFixture("conformance-repros", "undecided-first-render");
  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.map((region) => ({
      decided: region.firstRenderState,
      possible: region.possibleFirstRenderStates,
    }));

  it("lists every state the initial values allow", () => {
    expect(getFirstRenders("PushedInLoop")).toEqual([{ decided: null, possible: [0, 1] }]);
  });

  it("keeps a decided region to its one first state", () => {
    expect(getFirstRenders("IsArrayCheck")).toEqual([
      { decided: null, possible: [0, 1] },
      { decided: 3, possible: [3] },
    ]);
  });
});
