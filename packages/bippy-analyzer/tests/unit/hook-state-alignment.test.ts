import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import { createCapture, createTestAnalysis, createTestBinding, createTestReport } from "./helpers";

const stage = createTestBinding({ id: 0, name: "stage", hookKind: "useState" });

const analysis = createTestAnalysis("Task", [stage]);

const report = createTestReport([
  [{ bindingId: stage.id, path: [] }, [{ kind: "Literal", value: "idle" }]],
]);

const observeHookStates = (hookStates: unknown[]): Observation => ({
  props: {},
  path: [],
  action: null,
  before: null,
  after: createCapture({ shapes: [{ kind: "text", text: "task" }], hookStates }),
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
