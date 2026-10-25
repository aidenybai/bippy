import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("unary, power, bitwise and enum tests over known values", () => {
  const project = analyzeFixture("conformance-repros", "unary-case-tests");

  it("decides every test, including ~list.indexOf(x)", () => {
    const { states } = getComponent(project, "ProbeTests").report;
    expect(states.every((state) => state.conditions.length === 0)).toBe(true);
  });

  it("finds an entry of a constant table", () => {
    const values = getComponent(project, "EntriesFind").analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );
    expect(values).toEqual([{ kind: "Primitive", value: "idle" }]);
  });
});
