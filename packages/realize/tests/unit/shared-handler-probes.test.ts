import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { collectHandlerProbes } from "../conformance/verifier/handler-probes";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const page = (agents: string, categories: string): Shape[] => [
  element("div", [
    element("button", [text("Add")]),
    element(agents === "agents" ? "p" : "i", [text(agents)]),
    element("button", [text("Add")]),
    element(categories === "categories" ? "p" : "i", [text(categories)]),
  ]),
];

const clickAdd: Action = {
  key: "click:button:Add",
  kind: "click",
  tag: "button",
  label: "Add",
  isInChild: false,
};

describe("shared handler probes", () => {
  it("accepts a click that ran one of the handlers rendered at the same place", () => {
    const component = getComponent(
      analyzeFixture("conformance-repros", "shared-add-buttons"),
      "TwoLists",
    );
    const probeIds = [
      ...new Set(collectHandlerProbes(component.analysis).map(({ probe }) => probe.id)),
    ];
    expect(probeIds).toHaveLength(1);
    const before: Capture = createCapture({ shapes: page("no agents", "no categories") });
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: before },
      {
        props: {},
        path: [clickAdd.key],
        action: clickAdd,
        before,
        after: createCapture({ shapes: page("agents", "no categories"), handlerHits: probeIds }),
      },
    ];
    const verdict = scoreComponent(component.analysis, component.report, observations, new Map());
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
