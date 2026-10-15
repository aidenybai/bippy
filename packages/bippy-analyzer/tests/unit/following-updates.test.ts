import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const capture = (shapes: Shape[]): Capture => createCapture({ shapes });

const click = (label: string): Action => ({
  key: `click:button:${label}`,
  kind: "click",
  tag: "button",
  label,
  isInChild: false,
  clickAncestors: [],
});

const scoreClick = (componentName: string, label: string, before: Shape[], after: Shape[]) => {
  const project = analyzeFixture("conformance-repros", "following-updates");
  const { analysis, report } = getComponent(project, componentName);
  const action = click(label);
  const observations: Observation[] = [
    { props: {}, path: [], action: null, before: null, after: capture(before) },
    { props: {}, path: [action.key], action, before: capture(before), after: capture(after) },
  ];
  return scoreComponent(analysis, report, observations, new Map());
};

describe("updates that follow an action", () => {
  it("accepts a library calling back a component during an unrelated click", () => {
    const verdict = scoreClick(
      "DismissibleBanner",
      "Dismiss",
      [element("button", [text("Dismiss")])],
      [],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("accepts an effect that reruns because a click changed its dependency", () => {
    const verdict = scoreClick(
      "HeightResult",
      "Reset",
      [element("div", [element("button", [text("Reset")]), element("p", [text("Healthy")])])],
      [element("div", [element("button", [text("Reset")])])],
    );
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
