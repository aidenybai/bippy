import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("lazy state initializers", () => {
  const project = analyzeFixture("conformance-repros", "lazy-initializers");

  it("a useState initializer function supplies the initial value", () => {
    const { analysis, report } = getComponent(project, "LazyObject");
    expect(analysis.bindings.find((binding) => binding.name === "box")?.initial?.kind).toBe(
      "ObjectExpression",
    );
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("a useState initializer keeps the expression it computes", () => {
    const { analysis } = getComponent(project, "LazyFlag");
    expect(analysis.bindings.find((binding) => binding.name === "isB")?.initial?.kind).toBe(
      "BinaryExpression",
    );
  });

  it("a useReducer init function supplies the initial state", () => {
    const { analysis, report } = getComponent(project, "InitReducer");
    expect(analysis.bindings.find((binding) => binding.name === "state")?.initial?.kind).toBe(
      "ObjectExpression",
    );
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });
});
