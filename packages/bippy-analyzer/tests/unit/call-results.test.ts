import { beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";
import type { ProjectAnalysis } from "../../src/core/inference/types.js";
import { formatSymbolicValue } from "../../src/core/inference/values.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("typed call results", () => {
  let project: ProjectAnalysis;

  beforeAll(() => {
    project = analyzeProject(getFixtureConfig("calls"));
  });

  it("binds a cross-file boolean call and splits states on it", () => {
    const gate = getComponent(project, "Gate");
    expect(gate.analysis.bindings.map((binding) => [binding.name, binding.kind])).toEqual([
      ["role", "prop"],
      ['hasPermission(role, "edit")', "call"],
    ]);
    expect(gate.analysis.bindings[1]?.domain).toEqual({
      kind: "Cases",
      cases: [
        { kind: "Literal", value: false },
        { kind: "Literal", value: true },
      ],
      origin: "type",
    });
    expect(gate.report.states.map((state) => state.assumptions)).toEqual([
      ['!hasPermission(role, "edit")'],
      ['hasPermission(role, "edit")'],
    ]);
    expect(gate.analysis.bailouts).toEqual([]);
  });

  it("splits on every case of a literal union with undefined", () => {
    const status = getComponent(project, "Status");
    expect(status.analysis.bindings.map((binding) => binding.kind)).toEqual(["call"]);
    expect(status.report.states).toHaveLength(3);
  });

  it("keeps a call returning string Unknown", () => {
    const name = getComponent(project, "Name");
    expect(name.analysis.bindings).toEqual([]);
    expect(name.analysis.render).toMatchObject({
      kind: "JsxExpression",
      children: [{ kind: "Unknown", reason: "call" }],
    });
    expect(name.analysis.bailouts).toEqual([]);
  });

  it.each(["Badge", "Icon"])("bails out on a call returning JSX in %s", (componentName) => {
    const component = getComponent(project, componentName);
    expect(component.analysis.bindings).toEqual([]);
    expect(component.analysis.render).toMatchObject({
      children: [{ kind: "Unknown", reason: "call" }],
    });
    expect(component.analysis.bailouts.map((bailout) => bailout.reason)).toEqual(["unknown-call"]);
  });

  it("doesn't bind calls made in handlers", () => {
    const handlerCall = getComponent(project, "HandlerCall");
    expect(handlerCall.analysis.bindings.map((binding) => binding.kind)).toEqual(["prop", "state"]);
    expect(
      handlerCall.analysis.transitions[0]?.updates[0]?.guards.map(formatSymbolicValue),
    ).toEqual(["Unknown(call)"]);
  });

  it("keeps calls with different arguments independent", () => {
    const twoActions = getComponent(project, "TwoActions");
    expect(twoActions.report.states).toHaveLength(4);
  });

  it("doesn't treat a DOM element as JSX", () => {
    const domLookup = getComponent(project, "DomLookup");
    expect(domLookup.analysis.bailouts).toEqual([]);
    expect(domLookup.analysis.bindings.map((binding) => binding.kind)).toEqual(["call"]);
  });
});
