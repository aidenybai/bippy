import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
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

  it("can change once state holds it by reference", () => {
    expect(
      getComponent(project, "StateSharedConstant").report.states.map((state) => state.conditions),
    ).toEqual([["DEFAULTS.level === 2"], ["DEFAULTS.level !== 2"]]);
    expect(getComponent(project, "StateSharedConstant").report.regions[0]?.firstRenderState).toBe(
      1,
    );
    expect(getTargets("StateSharedConstant")[1]).toEqual([[0, 1]]);
  });

  it("is read as its literal when state holds a copy of its fields", () => {
    expect(
      getComponent(project, "StateCopiedConstant").report.states.map((state) => state.conditions),
    ).toEqual([[]]);
  });
});
