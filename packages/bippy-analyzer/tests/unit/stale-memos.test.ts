import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("stale memos", () => {
  const project = analyzeFixture("conformance-repros", "stale-memos");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("keeps a memo open when its deps leave out a value it reads", () => {
    expect(getConditions("StaleMemo")).toEqual([
      ["Unknown(memo) !== mode"],
      ["Unknown(memo) === mode"],
    ]);
  });

  it("keeps a memo's value when its deps cover what it reads", () => {
    expect(getConditions("FreshMemo")).toEqual([
      ['(mode === "a" ? "first" : "second") === "first"'],
      ['(mode === "a" ? "first" : "second") !== "first"'],
    ]);
  });

  it("counts a dep as covering a call result computed from it", () => {
    expect(getConditions("DerivedMemo")).toEqual([
      ['(sum(items) > 0 ? "some" : "none") === "some"'],
      ['(sum(items) > 0 ? "some" : "none") !== "some"'],
    ]);
  });

  it("follows a loop variable back to the values its loop reads", () => {
    expect(getConditions("FreshLoopMemo").map((conditions) => conditions.at(-1))).toEqual([
      "index > 0",
      "index <= 0",
      "-1 > 0",
      "-1 <= 0",
    ]);
    expect(getConditions("StaleLoopMemo").map((conditions) => conditions.at(-1))).toEqual([
      "Unknown(memo) > 0",
      "Unknown(memo) <= 0",
      "-1 > 0",
      "-1 <= 0",
    ]);
  });

  it("keeps a callback's stale read open while the callback stays known", () => {
    expect(getConditions("StaleCallbackRead")).toEqual([
      ["Unknown(memo) !== mode"],
      ["Unknown(memo) === mode"],
    ]);
    const { analysis } = getComponent(project, "StaleCallbackHandler");
    expect(
      analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => [update.binding.name, formatSymbolicValue(update.value)]),
      ),
    ).toEqual([["isOn", "!Unknown(memo)"]]);
  });
});
