import { beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";
import type { ProjectAnalysis, SymbolicValue } from "../../src/core/inference/types.js";
import { isRenderingNothing } from "../../src/core/inference/values.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

let project: ProjectAnalysis;

beforeAll(() => {
  project = analyzeProject(getFixtureConfig("folding"));
});

const getStateChildren = (name: string): SymbolicValue[][] =>
  getComponent(project, name).report.states.map((state) =>
    state.render.kind === "JsxExpression" ? state.render.children : [],
  );

describe("nullish folding", () => {
  it("folds an optional chain on null to its short-circuit", () => {
    const optional = getComponent(project, "OptionalOnNull");
    expect(optional.analysis.render).toMatchObject({
      kind: "JsxExpression",
      children: [{ kind: "Primitive", value: undefined }],
    });
    expect(optional.report.states).toHaveLength(1);
  });

  it("folds ?? on a null constant to its right side", () => {
    const coalesce = getComponent(project, "CoalesceNull");
    expect(coalesce.analysis.render).toMatchObject({
      children: [{ kind: "Binding", path: [] }],
    });
    expect(coalesce.report.states).toHaveLength(1);
  });

  it("folds ?? on a defined constant to its left side", () => {
    expect(getStateChildren("CoalesceDefined")).toEqual([[{ kind: "Primitive", value: "set" }]]);
  });

  it("still splits a null check on an unknown binding", () => {
    const nullCheck = getComponent(project, "UnknownNullCheck");
    expect(nullCheck.analysis.render).toMatchObject({ kind: "Conditional", testKind: "truthy" });
    expect(nullCheck.report.states.map((state) => state.assumptions)).toEqual([
      ["value != null"],
      ["value == null"],
    ]);
  });

  it("still splits ?? on an unknown binding", () => {
    expect(getComponent(project, "UnknownCoalesce").report.states).toHaveLength(2);
  });

  it("folds an optional chain on undefined to one branch", () => {
    expect(getComponent(project, "OptionalOnUndefined").report.states).toHaveLength(1);
  });

  it("folds ?? on an undefined constant to its fallback", () => {
    expect(getStateChildren("CoalesceUndefined")).toEqual([
      [{ kind: "Primitive", value: "fallback" }],
    ]);
  });
});

describe("resolveLiteral", () => {
  it("renders a branch-pinned binding as its literal", () => {
    expect(getStateChildren("PinnedMode")).toEqual([
      [{ kind: "Primitive", value: "edit" }],
      [{ kind: "Primitive", value: "view" }],
    ]);
  });

  it("renders a decided comparison as nothing", () => {
    const children = getStateChildren("DecidedComparison");
    expect(children).toEqual([
      [{ kind: "Primitive", value: true }],
      [{ kind: "Primitive", value: false }],
    ]);
    expect(children.flat().every(isRenderingNothing)).toBe(true);
  });

  it("keeps a binding that still has several values", () => {
    const [, otherwise] = getStateChildren("UnpinnedMode");
    expect(otherwise).toMatchObject([{ kind: "Binding", binding: { name: "mode" } }]);
  });
});
