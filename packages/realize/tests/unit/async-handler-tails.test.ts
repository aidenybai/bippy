import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent, getHandlerProbeId } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const screen = (status: string | null): Shape[] => [
  element("div", [
    element("button", [text("Send")]),
    ...(status ? [element("p", [text(status)])] : []),
  ]),
];

const clickSend: Action = {
  key: "click:button:Send",
  kind: "click",
  tag: "button",
  label: "Send",
  isInChild: false,
};

describe("an async handler that finishes during a later action", () => {
  const project = analyzeFixture("conformance-repros", "async-handler-tails");
  const component = getComponent(project, "SendRequest");
  const handlerHits = [getHandlerProbeId(component, "send")];

  const scoreSecondClick = (finished: string | null) => {
    const idle = createCapture({ shapes: screen(null) });
    const sending = createCapture({ shapes: screen("Sending"), handlerHits });
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: idle },
      { props: {}, path: [clickSend.key], action: clickSend, before: idle, after: sending },
      {
        props: {},
        path: [clickSend.key, clickSend.key],
        action: clickSend,
        before: sending,
        after: createCapture({ shapes: screen(finished), handlerHits }),
      },
    ];
    return scoreComponent(component.analysis, component.report, observations, new Map());
  };

  it("accepts the state the first click's await reaches", () => {
    expect(scoreSecondClick("Failed").transitionCounterexamples).toEqual([]);
  });

  it("still rejects a state the first click cannot reach", () => {
    expect(
      scoreSecondClick(null).transitionCounterexamples.map(
        (counterexample) => counterexample.reason,
      ),
    ).toEqual(["unpredicted-target"]);
  });
});
