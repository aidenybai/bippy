import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { createEmptyAnalysis } from "../../src/core/analyze-component";
import type { StateReport } from "../../src/core/types";
import { PlaceMap } from "../../src/core/utils/place";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import { createTestBinding } from "./helpers";

const stage = createTestBinding({ id: 0, name: "stage", hookKind: "useState" });

const analysis = {
  ...createEmptyAnalysis(
    {
      name: "Task",
      exportName: "Task",
      runtimeName: "Task",
      file: "/task.tsx",
      declaration: "/task.tsx#Task",
    },
    GeneratedSource,
    { kind: "Primitive", value: null },
  ),
  bindings: [stage],
};

const report: StateReport = {
  places: new PlaceMap([[{ bindingId: stage.id, path: [] }, [{ kind: "Literal", value: "idle" }]]]),
  states: [],
  regions: [],
  unreachableBranches: [],
  isTruncated: false,
};

const observeHookStates = (hookStates: unknown[]): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: {
    shapes: [{ kind: "text", text: "task" }],
    hookStates,
    probes: [],
    mutationHits: [],
    mutatedOwners: [],
    firstCommitShapes: null,
    error: null,
    errorDepth: null,
    failure: null,
  },
});

const getValueCounterexamples = (hookStates: unknown[]) =>
  scoreComponent(analysis, report, [observeHookStates(hookStates)], new Map()).valueCounterexamples;

describe("hook state alignment", () => {
  it("checks a state value when each state queue is one of the component's states", () => {
    expect(getValueCounterexamples(["done"])).toHaveLength(1);
  });

  it("skips state values when a library hook adds a state queue the analysis doesn't bind", () => {
    expect(getValueCounterexamples([false, "idle"])).toEqual([]);
  });
});
