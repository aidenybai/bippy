import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent, getHandlerProbeId } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const button = (label: string): Shape => element("button", [text(label)]);

const unlistedPanel = element("div", [
  element("b", [text("f0")]),
  ...["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((flag) => element("a", [text(flag)])),
]);

const screen = (isMenuOpen: boolean): Shape[] => [
  element("main", [
    button("Menu"),
    ...(isMenuOpen ? [element("nav", [text("Open menu")])] : []),
    button("Panel"),
    button("Show all"),
    unlistedPanel,
  ]),
];

const clickMenu: Action = {
  key: "click:button:Menu",
  kind: "click",
  tag: "button",
  label: "Menu",
  isInChild: false,
};

describe("region coverage", () => {
  const project = analyzeFixture("conformance-repros", "truncated-region");
  const component = getComponent(project, "Workspace");
  const menuHandlerHits = [getHandlerProbeId(component, "() => setIsMenuOpen(!isMenuOpen)")];
  const mounted = createCapture({ shapes: screen(false) });
  const observations: Observation[] = [
    { props: {}, path: [], action: null, before: null, after: mounted },
    {
      props: {},
      path: [clickMenu.key],
      action: clickMenu,
      before: mounted,
      after: createCapture({ shapes: screen(true), handlerHits: menuHandlerHits }),
    },
  ];
  const verdict = scoreComponent(component.analysis, component.report, observations, new Map());

  it("credits the regions a screen matched when another region's state is not listed", () => {
    expect(verdict.coveredStateIndices).toEqual([0, 1]);
    expect(verdict.stateCounterexamples).toEqual([]);
  });

  it("judges a transition in the regions matched on both sides", () => {
    expect(verdict.coveredTransitionCount).toBe(1);
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
