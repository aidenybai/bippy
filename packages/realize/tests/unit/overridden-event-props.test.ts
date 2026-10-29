import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("an event prop set twice on one element", () => {
  const project = analyzeFixture("conformance-repros", "overridden-event-props");

  const getUpdateTexts = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );

  it.each([
    ["AttributeThenSpread", ["2"]],
    ["SpreadThenAttribute", ["1"]],
    ["SecondSpreadWins", ["2"]],
  ])("runs only the later handler in %s", (name, updates) => {
    expect(getUpdateTexts(name)).toEqual(updates);
  });

  it("has no handler when a later spread sets it to undefined", () => {
    expect(getComponent(project, "SpreadClearsHandler").analysis.handlers).toEqual([]);
  });
});
