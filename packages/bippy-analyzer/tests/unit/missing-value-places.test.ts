import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { createEmptyAnalysis } from "../../src/core/analyze-component";
import type { StateReport } from "../../src/core/types";
import { PlaceMap } from "../../src/core/utils/place";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import { createTestBinding } from "./helpers";

const conflict = createTestBinding({ id: 0, name: "conflict", hookKind: "useState" });

const analysis = {
  ...createEmptyAnalysis(
    {
      name: "Dialog",
      exportName: "Dialog",
      runtimeName: "Dialog",
      file: "/dialog.tsx",
      declaration: "/dialog.tsx#Dialog",
    },
    GeneratedSource,
    { kind: "Primitive", value: null },
  ),
  bindings: [conflict],
};

const report: StateReport = {
  places: new PlaceMap([
    [
      { bindingId: conflict.id, path: ["conflictWith", "type"] },
      [{ kind: "Literal", value: "fixed" }],
    ],
  ]),
  states: [],
  regions: [],
  unreachableBranches: [],
  isTruncated: false,
};

const observeConflict = (conflictState: unknown): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: {
    shapes: [{ kind: "text", text: "dialog" }],
    hookStates: [conflictState],
    probes: [],
    mutationHits: [],
    mutatedOwners: [],
    firstCommitShapes: null,
    error: null,
    errorDepth: null,
    failure: null,
  },
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
