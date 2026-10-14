import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, getComponent } from "./helpers";

const IMAGE: Shape[] = [{ kind: "element", tag: "img", children: [] }];

const capture = (shapes: Shape[], firstCommitShapes: Shape[] | null): Capture => ({
  shapes,
  hookStates: [],
  probes: [],
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes,
  error: null,
  errorDepth: null,
  failure: null,
});

describe("spontaneous events", () => {
  it("accepts an image error handler that runs right after mount", () => {
    const project = analyzeFixture("conformance-repros", "image-fallback");
    const { analysis, report } = getComponent(project, "Avatar");
    const mount: Observation = {
      props: { username: { kind: "Value", value: "text" } },
      path: [],
      action: null,
      before: null,
      after: capture([], IMAGE),
    };
    const verdict = scoreComponent(analysis, report, [mount], new Map());
    expect(verdict.transitionCounterexamples).toEqual([]);
  });
});
