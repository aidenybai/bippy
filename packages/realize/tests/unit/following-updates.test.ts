import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent, getHandlerProbeId } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const capture = (shapes: Shape[], handlerHits: string[] = []): Capture =>
  createCapture({ shapes, handlerHits });

const click = (label: string): Action => ({
  key: `click:button:${label}`,
  kind: "click",
  tag: "button",
  label,
  isInChild: false,
});

const scoreClick = (
  componentName: string,
  label: string,
  handlerSource: string,
  before: Shape[],
  after: Shape[],
) => {
  const project = analyzeFixture("conformance-repros", "following-updates");
  const component = getComponent(project, componentName);
  const { analysis, report } = component;
  const action = click(label);
  const handlerHits = [getHandlerProbeId(component, handlerSource)];
  const observations: Observation[] = [
    { props: {}, path: [], action: null, before: null, after: capture(before) },
    {
      props: {},
      path: [action.key],
      action,
      before: capture(before),
      after: capture(after, handlerHits),
    },
  ];
  return scoreComponent(analysis, report, observations, new Map());
};

describe("updates that follow an action", () => {
  it("accepts a library calling back a component during an unrelated click", () => {
    const verdict = scoreClick(
      "DismissibleBanner",
      "Dismiss",
      "() => dismissAction.execute()",
      [element("button", [text("Dismiss")])],
      [],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("accepts an effect that reruns because a click changed its dependency", () => {
    const verdict = scoreClick(
      "HeightResult",
      "Reset",
      "() => setHeight(0)",
      [element("div", [element("button", [text("Reset")]), element("p", [text("Healthy")])])],
      [element("div", [element("button", [text("Reset")])])],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("runs an effect the click re-runs from where the click leaves the component", () => {
    const buttons = [element("button", [text("Record")]), element("button", [text("Stop")])];
    const verdict = scoreClick(
      "ShortcutRecorder",
      "Stop",
      "() => setIsRecording(false)",
      [element("div", [...buttons, element("p", [text("Recording, rejected")])])],
      [element("div", buttons)],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("accepts an element the click renders failing right away", () => {
    const verdict = scoreClick(
      "LazyImage",
      "Load",
      "() => setIsLoaded(true)",
      [element("button", [text("Load")])],
      [element("a", [text("Image")])],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
