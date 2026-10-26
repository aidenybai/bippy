import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

const BUTTON: Shape[] = [
  { kind: "element", tag: "button", children: [{ kind: "text", text: "show" }] },
];
const SECTION: Shape[] = [
  { kind: "element", tag: "section", children: [{ kind: "text", text: "details" }] },
];

const mountWith = (firstCommitShapes: Shape[], shapes: Shape[]): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: createCapture({ shapes, firstCommitShapes }),
});

describe("first render states", () => {
  const project = analyzeFixture("conformance-repros", "first-render-states");
  const { analysis, report } = getComponent(project, "Disclosure");

  it("accepts a first commit in the state the initial values decide", () => {
    const verdict = scoreComponent(analysis, report, [mountWith(BUTTON, BUTTON)], new Map());
    expect(verdict.stateCounterexamples).toEqual([]);
  });

  it("refutes a first commit in a state only a handler reaches", () => {
    const verdict = scoreComponent(analysis, report, [mountWith(SECTION, SECTION)], new Map());
    expect(verdict.stateCounterexamples).toEqual([
      expect.objectContaining({ path: ["first commit"], rendered: '<section>"details"</section>' }),
    ]);
  });
});
