import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  chooseReplaySample,
  joinDecisionAssignments,
  replayEnumeratedStates,
} from "../src/harness/state-replay.js";
import {
  compareStaticToRuntime,
  enumerateStaticStates,
  formatCompareRenderResult,
} from "../src/harness/index.js";
import { enumerateStateSpace, pinDecisions } from "../src/harness/state-space.js";
import {
  COMPONENTS_DIRECTORY,
  createComponentRenderer,
  runComponentFixture,
} from "./helpers/component-runner.js";
import { anonymousRepeat, choiceBranch, patternHost } from "./helpers/pattern-builders.js";

const fiber = patternHost;
const branch = choiceBranch;
const repeat = anonymousRepeat;

const describeAssignment = (conditions: { variable: string; kind: string }[]): string =>
  conditions
    .map((condition) =>
      "alternativeIndex" in condition
        ? `${condition.variable}=${String(condition.alternativeIndex)}`
        : `${condition.variable}×${String("count" in condition ? condition.count : "")}`,
    )
    .join(" ");

describe("chooseReplaySample", () => {
  it("replays every assignment while the bound allows", () => {
    expect(chooseReplaySample(3, 1, 16)).toEqual([0, 1, 2]);
  });

  it("always includes the runtime-matched assignment and spreads the rest", () => {
    const sample = chooseReplaySample(100, 57, 4);
    expect(sample).toHaveLength(4);
    expect(sample).toContain(57);
    expect(sample).toContain(0);
    expect(sample).toContain(99);
  });

  it("spreads the sample over the enumeration order", () => {
    expect(chooseReplaySample(10, 0, 3)).toEqual([0, 5, 9]);
    expect(chooseReplaySample(10, 4, 3)).toEqual([0, 4, 9]);
    expect(chooseReplaySample(10, null, 3)).toEqual([0, 5, 9]);
  });
});

describe("joinDecisionAssignments", () => {
  it("joins the variables of separately enumerated commits", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("main", [branch("a", [fiber("x")], [fiber("y")])])],
      [fiber("main", [branch("b", [fiber("p")], [fiber("q")])])],
    ]);
    const assignments = joinDecisionAssignments(stateSpace);
    expect(assignments.map((assignment) => describeAssignment(assignment.conditions))).toEqual([
      "a=0 b=0",
      "a=0 b=1",
      "a=1 b=0",
      "a=1 b=1",
    ]);
    const stateOf = (description: string): number =>
      stateSpace.states.findIndex(
        (state) =>
          describeAssignment(state.conditions.filter((c) => c.kind !== "transition")) ===
          description,
      );
    expect(assignments[0].stateIndices).toEqual([stateOf("a=0"), stateOf("b=0")]);
  });

  it("claims an unconditional commit for every assignment", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("loading")],
      [fiber("main", [branch("a", [fiber("x")], [fiber("y")])])],
    ]);
    const assignments = joinDecisionAssignments(stateSpace);
    expect(assignments).toHaveLength(2);
    for (const assignment of assignments) expect(assignment.stateIndices).toContain(0);
  });

  it("keeps nested decisions under the alternative they live in", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("main", [branch("a", [branch("b", [fiber("p")], [fiber("q")])], [fiber("y")])])],
    ]);
    expect(
      joinDecisionAssignments(stateSpace).map((assignment) =>
        describeAssignment(assignment.conditions),
      ),
    ).toEqual(["a=0 b=0", "a=0 b=1", "a=1"]);
  });
});

describe("pinDecisions", () => {
  it("pins the chosen alternative and the decisions inside it", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("main", [branch("a", [branch("b", [fiber("p")], [fiber("q")])], [fiber("y")])])],
    ]);
    const nested = stateSpace.states.find(
      (state) =>
        describeAssignment(state.conditions.filter((c) => c.kind !== "transition")) === "a=0 b=1",
    );
    if (!nested) throw new Error("a=0 b=1 was not enumerated");
    const pins = pinDecisions(stateSpace, [
      nested.conditions.filter((condition) => condition.kind !== "transition"),
    ]);
    const outer = pins.branches.get("a");
    expect(outer?.alternativeIndex).toBe(0);
    expect(outer?.inside.branches.get("b")?.alternativeIndex).toBe(1);
    expect(pins.branches.has("b")).toBe(false);
  });

  it("pins one scope per repeat iteration", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("ul", [repeat("items", [fiber("li", [branch("done", [fiber("s")], [])])])])],
    ]);
    const twice = stateSpace.states.filter((state) =>
      state.conditions.some((condition) => condition.kind === "repeat" && condition.count === 2),
    );
    expect(twice.length).toBeGreaterThan(1);
    const mixed = twice.find((state) => {
      const chosen = state.conditions.flatMap((condition) =>
        condition.kind === "branch" ? [condition.alternativeIndex] : [],
      );
      return chosen.length === 2 && chosen[0] !== chosen[1];
    });
    if (!mixed) throw new Error("iterations deciding differently were not enumerated");
    const pins = pinDecisions(stateSpace, [
      mixed.conditions.filter((condition) => condition.kind !== "transition"),
    ]);
    const iterations = pins.repeats.get("items")?.iterations ?? [];
    expect(iterations).toHaveLength(2);
    const chosen = iterations.map((iteration) => iteration.branches.get("done")?.alternativeIndex);
    expect(new Set(chosen)).toEqual(new Set([0, 1]));
  });

  it("keeps decisions met in an earlier commit", () => {
    const stateSpace = enumerateStateSpace([
      [fiber("main", [branch("a", [fiber("x")], [fiber("y")])])],
      [fiber("main", [branch("b", [fiber("p")], [fiber("q")])])],
    ]);
    const [joint] = joinDecisionAssignments(stateSpace);
    const pins = pinDecisions(stateSpace, joint.pinnedConditions);
    expect([...pins.branches.keys()].sort()).toEqual(["a", "b"]);
  });
});

describe("replayEnumeratedStates", () => {
  const fixtureNamed = (name: string) => ({ name, filePath: join(COMPONENTS_DIRECTORY, name) });

  it("reports and corrects an alternative the combined render contaminated", async () => {
    const run = await runComponentFixture(fixtureNamed("render-counter-interference.tsx"));
    const detail = formatCompareRenderResult(run.comparison);
    const replay = run.comparison.stateReplay;
    expect(replay, detail).not.toBeNull();
    expect(replay?.replayed, detail).toBe(2);
    expect(replay?.mismatched, detail).toHaveLength(1);
    expect(replay?.mismatched[0]).toMatchObject({
      isCorrected: true,
      divergence: { expected: '"2"', actual: '"1"' },
    });
    expect(run.comparison.report.status, detail).toBe("exact");
    const matched = run.comparison.matchedState;
    expect(matched?.index, detail).not.toBeNull();
    if (matched?.index === null || matched === null) return;
    const matchedTree = JSON.stringify(run.comparison.stateSpace.states[matched.index].tree);
    expect(matchedTree, detail).toContain('"text":"1"');
    expect(matchedTree, detail).not.toContain('"text":"2"');
  });

  it("cannot correct a replay that leaves decisions open", async () => {
    const fixture = fixtureNamed("ref-interference.tsx");
    const renderer = createComponentRenderer();
    const run = await runComponentFixture(fixture);
    const derived = compareStaticToRuntime(enumerateStaticStates(run.staticResult), run.runtime);
    expect(derived.report.status).toBe("mismatch");
    const replayed = await replayEnumeratedStates(derived, () =>
      renderer.renderComponent(fixture.filePath),
    );
    const detail = formatCompareRenderResult(replayed);
    expect(replayed.report.status, detail).toBe("mismatch");
    expect(
      replayed.stateReplay?.mismatched.every((mismatch) => !mismatch.isCorrected),
      detail,
    ).toBe(true);
    expect(replayed.stateSpace.states, detail).toEqual(derived.stateSpace.states);
  });

  it("marks a matched result unsound when its replay leaves decisions open", async () => {
    const fixture = fixtureNamed("optional-chains.tsx");
    const run = await runComponentFixture(fixture);
    const renderer = createComponentRenderer();
    const derived = compareStaticToRuntime(enumerateStaticStates(run.staticResult), run.runtime);
    expect(derived.report.status).toBe("exact");
    const replayed = await replayEnumeratedStates(
      derived,
      () => renderer.renderComponent(fixture.filePath),
      { maxReplayed: 2 },
    );
    const detail = formatCompareRenderResult(replayed);
    expect(replayed.report.status, detail).toBe("unsound");
    expect(
      replayed.stateReplay?.mismatched.map((mismatch) => mismatch.isCorrected),
      detail,
    ).toEqual([false, false]);
    expect(replayed.matchedState, detail).toBeNull();
    expect(replayed.closestState?.index, detail).toBe(derived.matchedState?.index);
  });

  it("bounds the replay and still replays the matched assignment", async () => {
    const fixture = fixtureNamed("optional-chains.tsx");
    const run = await runComponentFixture(fixture);
    const renderer = createComponentRenderer();
    const derived = compareStaticToRuntime(enumerateStaticStates(run.staticResult), run.runtime);
    const pinnedRenders: number[] = [];
    const replayed = await replayEnumeratedStates(
      derived,
      (decisions) => {
        pinnedRenders.push(decisions.branches.size + decisions.repeats.size);
        return renderer.derive({ decisions }).renderComponent(fixture.filePath);
      },
      { maxReplayed: 3 },
    );
    const detail = formatCompareRenderResult(replayed);
    expect(replayed.stateReplay, detail).toMatchObject({
      replayed: 3,
      maxReplayed: 3,
      mismatched: [],
    });
    expect(replayed.stateReplay?.assignments ?? 0, detail).toBeGreaterThan(3);
    expect(pinnedRenders, detail).toHaveLength(3);
    expect(replayed.report.status, detail).toBe(derived.report.status);
  });
});
