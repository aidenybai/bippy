import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a built-in read of a constant array, object or Map", () => {
  const project = analyzeFixture("conformance-repros", "constant-reads");

  const getUpdatedValues = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  it.each([
    ["AtLiteral", "done"],
    ["AtModule", "done"],
    ["FindModule", "done"],
    ["MapGetModule", 2],
    ["MapHasModule", true],
    ["ValuesByIndex", "done"],
    ["KeysByIndex", "busy"],
    ["EntriesByIndex", "busy"],
  ])("%s folds to %s", (name, value) => {
    expect(getUpdatedValues(name)).toEqual([{ kind: "Primitive", value }]);
  });
});
