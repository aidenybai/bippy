import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a component whose function is named apart from its binding", () => {
  const project = analyzeFixture("conformance-repros", "export-binding-names");

  it.each([
    ["Impl", "OtherNameMemo"],
    ["ForwardNamedImpl", "ForwardNamed"],
    ["NamedExprImpl", "NamedExpr"],
    ["SameNameMemo", "SameNameMemo"],
  ])("%s is exported and declared as %s", (name, exportName) => {
    const { analysis } = getComponent(project, name);
    expect(analysis.exportName).toBe(exportName);
    expect(analysis.declaration.endsWith(`#${exportName}`)).toBe(true);
  });

  it("is linked from a parent that renders its binding", () => {
    const parent = getComponent(project, "Parent");
    expect(parent.links.map((link) => link.child.split("#").at(-1))).toEqual(["LocalMemo"]);
  });
});
