import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import { getStateOwner } from "../conformance/verifier/types";
import type { Action } from "../conformance/verifier/types";
import { createCapture, createTestAnalysis, createTestBinding, createTestReport } from "./helpers";

const box = createTestBinding({ id: 0, name: "box", hookKind: "useState" });

const analysis = createTestAnalysis("Box", [box]);

const CLICK: Action = {
  key: "button:1",
  kind: "click",
  tag: "button",
  label: "1",
  isInChild: false,
};

const report = createTestReport([
  [{ bindingId: box.id, path: ["level"] }, [{ kind: "Literal", value: 1 }]],
]);

const observe = (path: string[], level: number, mutatedOwners: string[] = []): Observation => ({
  props: {},
  path,
  action: path.length === 0 ? null : CLICK,
  before: null,
  after: createCapture({
    shapes: [{ kind: "text", text: "box" }],
    hookStates: [{ level }],
    mutatedOwners,
  }),
});

const getValueCounterexamples = (observations: Observation[]) =>
  scoreComponent(analysis, report, observations, new Map()).valueCounterexamples;

describe("value checks on state mutated in place", () => {
  it("checks a stored value that changed without an in-place mutation", () => {
    expect(getValueCounterexamples([observe([], 1), observe(["click"], 2)])).toHaveLength(1);
  });

  it("skips a stored value after an action mutated it in place", () => {
    const mutated = observe(["click"], 2, [getStateOwner(0)]);
    expect(getValueCounterexamples([observe([], 1), mutated])).toEqual([]);
  });

  it("keeps skipping it on later actions along the same path", () => {
    const mutated = observe(["click"], 2, [getStateOwner(0)]);
    const later = observe(["click", "other"], 2);
    expect(getValueCounterexamples([observe([], 1), mutated, later])).toEqual([]);
  });
});
