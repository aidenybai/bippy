import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { getStateBindings } from "../conformance/verifier/region-matching";
import { analyzeFixture, createCapture, getComponent } from "./helpers";

describe("closures held by a ref's first value", () => {
  const project = analyzeFixture("conformance-repros", "ref-held-closures");

  it("read the first render's state, not the current one", () => {
    const { states } = getComponent(project, "RefHeldTable").report;
    const big = states.findIndex((state) => state.conditions.includes("n >= 4"));
    const two = states.findIndex((state) => state.conditions.includes("n === 2"));
    const targets = states[big]?.transitions.flatMap((transition) => transition.targets);
    expect(targets).toContain(two);
  });

  it("leave the verifier's hook states unmapped when a hook has no binding", () => {
    const { analysis } = getComponent(project, "UnusedStateBesideMemo");
    const observation: Observation = {
      props: {},
      path: [],
      action: null,
      before: null,
      after: createCapture({ hookStates: [0, [], "first"] }),
    };
    expect(getStateBindings(analysis, [observation])).toBeNull();
  });
});
