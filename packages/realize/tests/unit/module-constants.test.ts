import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a module-level constant", () => {
  const project = analyzeFixture("conformance-repros", "module-constants");

  const getUpdateTexts = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("is read as its literal in a record lookup", () => {
    expect(getUpdateTexts("RecordHelper")[0]).not.toContain("NEXT");
    expect(getTargets("RecordHelper")).toEqual([[[1]], [[0]], [[0]]]);
  });

  it("folds a field of a literal object", () => {
    expect(
      getComponent(project, "LimitHelper").report.states.map((state) => state.conditions),
    ).toEqual([["count === 3"], ["count !== 3"]]);
  });

  it("stays unknown when a handler writes it", () => {
    expect(getUpdateTexts("MutatedHelper")[0]).toContain("MUTABLE");
  });

  it("stays unknown when an alias of it is written", () => {
    expect(
      getComponent(project, "AliasedConstant").report.states.map((state) => state.conditions),
    ).toEqual([['SETTINGS.flag === "b"'], ['SETTINGS.flag !== "b"']]);
  });
});
