import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { getBranchId } from "../conformance/verifier/branch-counters";
import { toLocalExportName } from "../conformance/verifier/harness/local-exports";
import type { Observation } from "../conformance/verifier/driver";
import { checkComponent } from "../conformance/verifier/check";
import type { Action, Capture } from "../conformance/verifier/types";
import { formatCounterexamples } from "../conformance/verifier/verdict-report";
import { analyzeFixture, getComponent, getHandlerCounterId } from "./helpers";

describe("conformance coverage", () => {
  const wizard = getComponent(analyzeFixture("state-charts"), "Wizard");
  const nextCounterId = getHandlerCounterId(wizard, '() => dispatch({ type: "next" })');

  const getTestBranchId = (test: string): string => {
    const branch = wizard.model.branches.find((candidate) => candidate.label === test);
    if (!branch || branch.loc === GeneratedSource) throw new Error(`No branch tests ${test}`);
    return getBranchId(branch.file, branch.loc);
  };

  const capture = (
    step: string,
    edges: Record<string, boolean>,
    { hasError = false, handlerCalls = [] as string[] } = {},
  ): Capture => ({
    shapes: [{ kind: "element", tag: "form", children: [] }],
    stateValues: [{ step, hasError }],
    branchHits: Object.entries(edges).map(([test, isConsequent]) => ({
      id: getTestBranchId(test),
      isConsequent,
    })),
    handlerCalls,
    mutationHits: [],
    mutatedOrigins: [],
    error: null,
    errorDepth: null,
    failure: null,
  });

  const clickNext: Action = {
    key: "next",
    kind: "click",
    tag: "button",
    label: "Next",
  };

  const mount = (after: Capture): Observation => ({
    props: {},
    path: [],
    action: null,
    before: null,
    after,
  });

  const click = (before: Capture, after: Capture): Observation => ({
    props: {},
    path: [clickNext.key],
    action: clickNext,
    before,
    after,
  });

  const details = capture("details", {
    'state.step === "done"': false,
    "state.hasError": false,
    'state.step === "details"': true,
    'state.step === "payment"': false,
  });

  const payment = capture(
    "payment",
    {
      'state.step === "done"': false,
      "state.hasError": false,
      'state.step === "details"': false,
      'state.step === "payment"': true,
    },
    { handlerCalls: [nextCounterId] },
  );

  const score = (observations: Observation[]) =>
    checkComponent(wizard.analysis, wizard.model, observations);

  it("accepts renders and transitions the model reaches", () => {
    const verdict = score([mount(details), click(details, payment)]);
    expect(formatCounterexamples(verdict)).toEqual([]);
    expect(verdict.checkedTransitionCount).toBe(1);
    expect(verdict.coveredViews.length).toBeGreaterThan(0);
  });

  it("reports a branch edge the model calls unreachable", () => {
    const failed = capture(
      "details",
      { 'state.step === "done"': false, "state.hasError": true },
      { hasError: true },
    );
    expect(score([mount(failed)]).unreachableEdgesTaken).toEqual(["state.hasError is true L26"]);
  });

  it("reports a state value outside its domain", () => {
    const verdict = score([mount(capture("review", {}))]);
    expect(formatCounterexamples(verdict)).toEqual([
      'state.step = "review" is outside the domain details | done | payment',
    ]);
  });

  it("reports a render no model state explains", () => {
    const contradicted = capture("payment", { 'state.step === "details"': true });
    expect(score([mount(contradicted)]).renderCounterexamples).toHaveLength(1);
  });

  it("reports a transition with no model path", () => {
    const done = capture(
      "done",
      { 'state.step === "done"': true },
      { handlerCalls: [nextCounterId] },
    );
    expect(score([mount(details), click(details, done)]).transitionCounterexamples).toEqual([
      { path: ["next"], action: "Next", handlers: ["t2"] },
    ]);
  });
});

describe("conformance coverage of steps the model leaves out", () => {
  const project = analyzeFixture("symbolic-tree");

  const createCapture = (overrides: Partial<Capture>): Capture => ({
    shapes: [{ kind: "element", tag: "div", children: [] }],
    stateValues: [],
    branchHits: [],
    handlerCalls: [],
    mutationHits: [],
    mutatedOrigins: [],
    error: null,
    errorDepth: null,
    failure: null,
    ...overrides,
  });

  it("accepts a click whose handler changes no model variable", () => {
    const button = getComponent(project, "Button");
    const clickCounterId = getHandlerCounterId(button, "onClick");
    const before = createCapture({});
    const after = createCapture({ handlerCalls: [clickCounterId] });
    const click: Action = { key: "click", kind: "click", tag: "button", label: "text" };
    const analysis = { ...button.analysis, exportName: toLocalExportName("Button") };
    const verdict = checkComponent(analysis, button.model, [
      { props: {}, path: [], action: null, before: null, after: before },
      { props: {}, path: [click.key], action: click, before, after },
    ]);
    expect(verdict.transitionCounterexamples).toEqual([]);
    expect(verdict.checkedTransitionCount).toBe(1);
  });

  it("accepts a branch test the render evaluates outside the side that shows its value", () => {
    const opaqueCallback = getComponent(project, "OpaqueCallback");
    const branchHits = opaqueCallback.model.branches.map((branch) => {
      if (branch.loc === GeneratedSource) throw new Error(`No location for ${branch.label}`);
      return { id: getBranchId(branch.file, branch.loc), isConsequent: true };
    });
    const verdict = checkComponent(opaqueCallback.analysis, opaqueCallback.model, [
      { props: {}, path: [], action: null, before: null, after: createCapture({ branchHits }) },
    ]);
    expect(opaqueCallback.model.branches.map((branch) => branch.label)).toEqual([
      "user?.name",
      "user != null",
    ]);
    expect(verdict.renderCounterexamples).toEqual([]);
  });
});
