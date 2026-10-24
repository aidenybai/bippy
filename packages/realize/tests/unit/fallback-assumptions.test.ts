import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("nullish fallbacks", () => {
  const project = analyzeFixture("conformance-repros", "fallback-assumptions");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("drops the state a ?? fallback rules out once its operand is known", () => {
    expect(getConditions("NullishLabel")).toEqual([
      ['(label ?? "Untitled") === "Untitled"'],
      ['(label ?? "Untitled") !== "Untitled"'],
    ]);
  });

  it("drops the state a ternary fallback rules out once its test is known", () => {
    expect(getConditions("TernaryLabel")).toEqual([
      ['(label != null ? label : "Untitled") === "Untitled"'],
      ['(label != null ? label : "Untitled") !== "Untitled"'],
    ]);
  });
});
