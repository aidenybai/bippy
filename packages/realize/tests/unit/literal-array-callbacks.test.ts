import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("an array method with a callback on a literal in a handler", () => {
  const project = analyzeFixture("conformance-repros", "literal-array-callbacks");
  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );

  it("folds filter", () => {
    expect(getUpdates("FilteredLiteralLength")).toEqual(["2"]);
  });

  it("folds map", () => {
    expect(getUpdates("MappedLiteralItem")).toEqual(["6"]);
  });

  it("folds some", () => {
    expect(getUpdates("SomeOfLiteral")).toEqual(["true"]);
  });
});
