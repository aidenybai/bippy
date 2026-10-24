import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("lookups into a literal table by a number or a numeric string", () => {
  const project = analyzeFixture("conformance-repros", "number-key-tables");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("reads an object's number key with a number", () => {
    expect(getTargets("NumberKeyTable", "step !== 1")).toEqual([
      ["step === 2"],
      ["step !== 2", "step !== 1"],
    ]);
    expect(getTargets("NumberKeyTable", "step === 2")).toEqual([["step !== 2", "step === 1"]]);
    expect(getTargets("NumberKeyTable", "step === 1")).toEqual([["step !== 2", "step !== 1"]]);
  });

  it("reads an array index with a numeric string", () => {
    const condition = '(slot === "0" ? 2 : slot === "1" ? 0 : undefined) === 0';
    expect(getTargets("StringIndexIntoArray", condition.replace(/=== 0$/, "!== 0"))).toEqual([
      [condition],
    ]);
  });
});
