import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import { createCapture, createTestAnalysis, createTestBinding, createTestReport } from "./helpers";

const conflict = createTestBinding({ id: 0, name: "conflict", hookKind: "useState" });

const analysis = createTestAnalysis("Dialog", [conflict]);

const report = createTestReport([
  [
    { bindingId: conflict.id, path: ["conflictWith", "type"] },
    [{ kind: "Literal", value: "fixed" }],
  ],
]);

const observeConflict = (conflictState: unknown): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: createCapture({ shapes: [{ kind: "text", text: "dialog" }], hookStates: [conflictState] }),
});

const getValueCounterexamples = (conflictState: unknown) =>
  scoreComponent(analysis, report, [observeConflict(conflictState)], new Map())
    .valueCounterexamples;

describe("missing value places", () => {
  it("skips a field whose parent object doesn't exist", () => {
    expect(getValueCounterexamples(null)).toEqual([]);
  });

  it("still checks a field whose parent exists", () => {
    expect(getValueCounterexamples({ conflictWith: { type: "configurable" } })).toHaveLength(1);
  });
});
