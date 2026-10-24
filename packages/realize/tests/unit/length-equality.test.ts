import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("length equality", () => {
  const project = analyzeFixture("conformance-repros", "length-equality");

  const getReport = (name: string) => {
    const { report } = getComponent(project, name);
    return {
      firstRender: report.regions.map((region) => region.firstRenderState),
      targets: report.states.map((state) =>
        state.transitions.map((transition) => transition.targets),
      ),
    };
  };

  it("decides an array's length equality from a literal update", () => {
    expect(getReport("LenEqual")).toEqual({
      firstRender: [0],
      targets: [
        [[1], [0]],
        [[1], [0]],
      ],
    });
  });

  it("decides a length equality other than zero", () => {
    expect(getReport("LenTwo")).toEqual({
      firstRender: [1],
      targets: [
        [[0], [1]],
        [[0], [1]],
      ],
    });
  });

  it("decides a string's length equality from a literal update", () => {
    expect(getReport("TextEmpty")).toEqual({
      firstRender: [0],
      targets: [
        [[1], [0]],
        [[1], [0]],
      ],
    });
  });
});
