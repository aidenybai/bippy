import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("arithmetic on two literals", () => {
  const project = analyzeFixture("conformance-repros", "fold-arithmetic");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  const getStateCount = (name: string) => getComponent(project, name).report.states.length;

  it("folds a sum of destructured elements", () => {
    expect(getUpdates("DestructuredRead")).toEqual([{ kind: "Primitive", value: 6 }]);
    expect(getStateCount("DestructuredRead")).toBe(2);
  });

  it("folds a product and a difference of destructured fields", () => {
    expect(getUpdates("FieldRead")).toEqual([{ kind: "Primitive", value: 3 }]);
    expect(getStateCount("FieldRead")).toBe(2);
  });

  it("joins two string literals", () => {
    expect(getUpdates("JoinedRead")).toEqual([{ kind: "Primitive", value: "L2" }]);
    expect(getStateCount("JoinedRead")).toBe(2);
  });
});
