import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("mutations the analysis can't see", () => {
  const project = analyzeFixture("conformance-repros", "unwarned-mutations");

  const getWarnings = (name: string) =>
    getComponent(project, name).analysis.warnings.map((warning) => warning.kind);

  it.fails("warns about a prop mutated through a field of a ref", () => {
    expect(getWarnings("RefAliasMutation")).toEqual(["prop-mutation"]);
  });

  it.fails("warns about a prop mutated through a class method that calls another", () => {
    expect(getWarnings("ClassMethodMutation")).toEqual(["prop-mutation"]);
  });
});
