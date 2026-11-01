import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { getProbeId } from "../conformance/verifier/branch-probes";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture } from "../conformance/verifier/types";
import { formatCounterexamples } from "../conformance/verifier/verdict-report";
import { analyzeFixture, getComponent, getHandlerProbeId } from "./helpers";

describe("conformance coverage", () => {
  const wizard = getComponent(analyzeFixture("symbolic-tree"), "Wizard");
  const nextProbeId = getHandlerProbeId(wizard, '() => dispatch({ type: "next" })');

  const getSideProbeId = (test: string): string => {
    const arm = wizard.model.arms.find((candidate) => candidate.test === test);
    if (!arm || arm.loc === GeneratedSource) throw new Error(`No arm tests ${test}`);
    return getProbeId(arm.file, arm.loc);
  };

  const capture = (
    step: string,
    sides: Record<string, boolean>,
    { hasError = false, handlerHits = [] as string[] } = {},
  ): Capture => ({
    shapes: [{ kind: "element", tag: "form", children: [] }],
    hookStates: [{ step, hasError }],
    probes: Object.entries(sides).map(([test, isTrueSide]) => ({
      id: getSideProbeId(test),
      isTrueSide,
    })),
    handlerHits,
    mutationHits: [],
    mutatedOwners: [],
    firstCommitShapes: null,
    error: null,
    errorDepth: null,
    failure: null,
  });

  const clickNext: Action = {
    key: "next",
    kind: "click",
    tag: "button",
    label: "Next",
    isInChild: false,
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
    { handlerHits: [nextProbeId] },
  );

  const score = (observations: Observation[]) =>
    scoreComponent(wizard.analysis, wizard.model, observations);

  it("accepts renders and transitions the model reaches", () => {
    const verdict = score([mount(details), click(details, payment)]);
    expect(formatCounterexamples(verdict)).toEqual([]);
    expect(verdict.checkedTransitionCount).toBe(1);
    expect(verdict.coveredScreens.length).toBeGreaterThan(0);
  });

  it("reports a branch side the model calls unreachable", () => {
    const failed = capture(
      "details",
      { 'state.step === "done"': false, "state.hasError": true },
      { hasError: true },
    );
    expect(score([mount(failed)]).reachedUnreachableSides).toEqual(["state.hasError is true L26"]);
  });

  it("reports a state value outside every cell", () => {
    const verdict = score([mount(capture("review", {}))]);
    expect(formatCounterexamples(verdict)).toEqual([
      'state.step = "review" fits no cell of details | done | payment',
    ]);
  });

  it("reports a render no model state explains", () => {
    const contradicted = capture("payment", { 'state.step === "details"': true });
    expect(score([mount(contradicted)]).renderCounterexamples).toHaveLength(1);
  });

  it("reports a transition with no model path", () => {
    const done = capture("done", { 'state.step === "done"': true }, { handlerHits: [nextProbeId] });
    expect(score([mount(details), click(details, done)]).transitionCounterexamples).toEqual([
      { path: ["next"], action: "Next", handlers: ["t2"] },
    ]);
  });
});
