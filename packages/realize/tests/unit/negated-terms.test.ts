import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a bound written with the atom on the minus side", () => {
  const project = analyzeFixture("conformance-repros", "negated-terms");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("decides constant - atom against the atom", () => {
    expect(getConditions("RemainingSeats")).toEqual([["10 - used > 0"], ["10 - used <= 0"]]);
  });

  it("decides a negated atom against the atom", () => {
    expect(getConditions("NegatedBalance")).toEqual([["-balance < 0"], ["-balance >= 0"]]);
  });
});
