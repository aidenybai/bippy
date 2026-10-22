import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a built-in mutator applied to state", () => {
  const project = analyzeFixture("conformance-repros", "builtin-mutators");

  const getWarnings = (name: string) =>
    getComponent(project, name).analysis.warnings.map((warning) => warning.kind);

  for (const name of ["ObjectAssign", "InnerAssign", "ReflectSet", "PrototypeCall"]) {
    it(`${name} warns about the state mutation`, () => {
      expect(getWarnings(name)).toEqual(["state-mutation"]);
    });
  }

  it("does not warn when the state is only copied", () => {
    expect(getWarnings("CopyAssign")).toEqual([]);
  });
});
