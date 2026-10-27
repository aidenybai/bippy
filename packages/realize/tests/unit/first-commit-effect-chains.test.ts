import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

const paragraph = (text: string): Shape[] => [
  { kind: "element", tag: "p", children: [{ kind: "text", text }] },
];

const mountWith = (firstCommitShapes: Shape[], shapes: Shape[]): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: createCapture({ shapes, firstCommitShapes }),
});

describe("the first commit's effects", () => {
  const project = analyzeFixture("react-tests", "effect-ordering");
  const { analysis, report } = getComponent(project, "LayoutBeforePassive");

  it("explains a settled state that a layout effect and then a passive effect reach", () => {
    const observation = mountWith(paragraph("none"), paragraph("layout then passive"));
    const verdict = scoreComponent(analysis, report, [observation], new Map());
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("still refutes a settled state no chain of effects reaches", () => {
    const observation = mountWith(paragraph("layout"), paragraph("none"));
    const verdict = scoreComponent(analysis, report, [observation], new Map());
    expect(verdict.transitionCounterexamples).toEqual([
      expect.objectContaining({ action: "first commit", reason: "unpredicted-effect" }),
    ]);
  });
});
