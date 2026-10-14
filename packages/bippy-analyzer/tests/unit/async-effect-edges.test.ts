import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, getComponent } from "./helpers";

const renderKeyStatus = (status: string): Shape[] => [
  {
    kind: "element",
    tag: "div",
    children: [
      { kind: "element", tag: "button", children: [{ kind: "text", text: "Save" }] },
      { kind: "element", tag: "p", children: [{ kind: "text", text: status }] },
    ],
  },
];

const capture = (status: string): Capture => ({
  shapes: renderKeyStatus(status),
  hookStates: [],
  probes: [],
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error: null,
  errorDepth: null,
  failure: null,
});

describe("async effect edges", () => {
  it("accepts a subscription update that lands after an action", () => {
    const project = analyzeFixture("conformance-repros", "store-subscription");
    const { analysis, report } = getComponent(project, "KeyStatus");
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: capture("No key") },
      {
        props: {},
        path: ["click:button:Save"],
        action: {
          key: "click:button:Save",
          kind: "click",
          tag: "button",
          label: "Save",
          isInChild: false,
          clickAncestors: [],
        },
        before: capture("No key"),
        after: capture("Has key"),
      },
    ];
    const verdict = scoreComponent(analysis, report, observations, new Map());
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
