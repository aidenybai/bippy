import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent, getHandlerProbeId } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const loadButton = [element("button", [text("Load")])];

const loadedImage = [element("img", [])];

const clickLoad: Action = {
  key: "click:button:Load",
  kind: "click",
  tag: "button",
  label: "Load",
  isInChild: false,
};

const scoreLoadClick = (after: Shape[], isHandlerRun: boolean) => {
  const project = analyzeFixture("conformance-repros", "following-updates");
  const component = getComponent(project, "LazyImage");
  const handlerHits = isHandlerRun ? [getHandlerProbeId(component, "() => setIsLoaded(true)")] : [];
  const before: Capture = createCapture({ shapes: loadButton });
  const observations: Observation[] = [
    { props: {}, path: [], action: null, before: null, after: before },
    {
      props: {},
      path: [clickLoad.key],
      action: clickLoad,
      before,
      after: createCapture({ shapes: after, handlerHits }),
    },
  ];
  return scoreComponent(component.analysis, component.report, observations, new Map());
};

describe("handler hits", () => {
  it("covers a transition when the handler the page ran predicts the change", () => {
    const verdict = scoreLoadClick(loadedImage, true);
    expect(verdict.transitionCounterexamples).toEqual([]);
    expect(verdict.coveredTransitionCount).toBe(1);
  });

  it("rejects a handler that ran without making its predicted change", () => {
    const verdict = scoreLoadClick(loadButton, true);
    expect(
      verdict.transitionCounterexamples.map((counterexample) => counterexample.reason),
    ).toEqual(["unpredicted-target"]);
  });

  it("accepts an unchanged screen when the click ran no handler, whatever its label", () => {
    expect(scoreLoadClick(loadButton, false).transitionCounterexamples).toEqual([]);
  });

  it("rejects a change no handler explains", () => {
    const verdict = scoreLoadClick(loadedImage, false);
    expect(
      verdict.transitionCounterexamples.map((counterexample) => counterexample.reason),
    ).toEqual(["unmodeled-handler"]);
  });
});
