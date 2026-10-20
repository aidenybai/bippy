import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("project functions that mutate their parameters", () => {
  const project = analyzeFixture("symbolic-tree", "mutating-helpers.tsx");

  it("warns when a prop is handed to a project function that writes into it", () => {
    const { analysis } = getComponent(project, "CardGrid");
    expect(analysis.warnings.map((warning) => [warning.kind, warning.message])).toEqual([
      ["prop-mutation", "mutates prop options"],
    ]);
  });

  it("warns when a handler hands state to one that writes into it through a local alias", () => {
    const { analysis } = getComponent(project, "CardEditor");
    expect(analysis.warnings.map((warning) => [warning.kind, warning.message])).toEqual([
      [
        "state-mutation",
        "mutates options without setting it, so the change shows only on the next render",
      ],
    ]);
  });
});
