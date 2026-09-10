import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { collectGuardSides } from "../src/harness/guard-coverage.js";
import { areGuardsSatisfiable } from "../src/harness/guard-solver.js";
import { joinDecisionAssignments } from "../src/harness/state-replay.js";
import { enumerateStateSpace, matchStateSpace } from "../src/harness/state-space.js";
import {
  constantGuard,
  negateGuard,
  orGuard,
  truthyGuard,
  type GuardContext,
} from "../src/harness/symbolic-tree.js";
import { CommitCauses } from "../src/materialize/commit-causes.js";
import { COMPONENTS_DIRECTORY, createComponentRenderer } from "./helpers/component-runner.js";
import { guardedBranch, input, patternHost } from "./helpers/pattern-builders.js";

const firstInput = input("first", "environment");
const secondInput = input("second", "environment");
const firstGuard = truthyGuard({ input: firstInput.id, path: [], measure: "value" });
const secondGuard = truthyGuard({ input: secondInput.id, path: [], measure: "value" });
const firstCause: GuardContext = { guard: firstGuard, inputs: [firstInput] };
const unconditional: GuardContext = { guard: constantGuard(true), inputs: [] };

const firstBranch = () =>
  guardedBranch("first", firstGuard, [firstInput], [patternHost("canvas")], [patternHost("aside")]);

const secondBranch = () =>
  guardedBranch(
    "second",
    secondGuard,
    [secondInput],
    [patternHost("strong")],
    [patternHost("span")],
  );

describe("commit causes", () => {
  it.each([
    ["effect-cause-commits.tsx", [2, 1]],
    ["effect-cause-chain.tsx", [2, 1, 1]],
    ["effect-cause-batched.tsx", [2, 2]],
    ["effect-cause-unmount.tsx", [2, 1]],
    ["effect-cause-timer.tsx", [2, 1]],
    ["ref-cause-commits.tsx", [2, 1]],
    ["ref-cause-shared.tsx", [2, 2]],
  ])("preserves reachable commit counts for %s", async (fixture, counts) => {
    const renderer = await createComponentRenderer();
    const result = await renderer.renderComponent(join(COMPONENTS_DIRECTORY, fixture));
    const space = enumerateStaticStates(result);
    expect(space.commitStates.map((commit) => commit.stateCount)).toEqual(counts);
    expect(result.commitCauses).toHaveLength(result.commits.length);
  });

  it("keeps ref identity when the same branch acquires a fresh predicate", async () => {
    const renderer = await createComponentRenderer();
    const result = await renderer.renderComponent(
      join(import.meta.dirname, "components/internal/ref-cause-identity.tsx"),
    );
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === "unsettled-state"),
    ).toEqual([]);
    expect(result.commits).toHaveLength(2);
  });

  it("joins clusters coupled by independently sufficient causes", () => {
    const space = enumerateStateSpace([[firstBranch(), secondBranch()]], undefined, [
      {
        guard: orGuard([firstGuard, secondGuard]),
        inputs: [firstInput, secondInput],
      },
    ]);
    expect(space.commitStates[0].clusters).toHaveLength(1);
    expect(space.stateCount).toBe(3);
    expect(space.states).toHaveLength(3);
  });

  it("retains a cause after its branch disappears from the committed tree", () => {
    const space = enumerateStateSpace([[firstBranch()], [patternHost("strong")]], undefined, [
      unconditional,
      firstCause,
    ]);
    const assignments = joinDecisionAssignments(space);
    expect(assignments.map((assignment) => assignment.stateIndices)).toEqual([[0, 2], [1]]);
    const commitSide = collectGuardSides(space.tree).find(
      (side) => side.kind === "commit" && side.side === 1,
    );
    expect(commitSide).toBeDefined();
    if (!commitSide) return;
    expect(areGuardsSatisfiable([commitSide.guard, negateGuard(firstGuard)])).toBe(false);
  });

  it("retains an earlier assignment when every later state contradicts it", () => {
    const derivedBranch = guardedBranch(
      "derived",
      firstGuard,
      [firstInput],
      [patternHost("strong")],
      [patternHost("span")],
    );
    const space = enumerateStateSpace([[firstBranch()], [derivedBranch]], undefined, [
      unconditional,
      firstCause,
    ]);
    const assignments = joinDecisionAssignments(space);
    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment) => assignment.stateIndices)).toEqual([[0, 2], [1]]);
    expect(assignments[1].conditions.map((condition) => condition.variable)).toEqual(["first"]);
  });

  it("does not pin decisions inside a commit with an incompatible cause", () => {
    const space = enumerateStateSpace([[firstBranch()], [secondBranch()]], undefined, [
      unconditional,
      firstCause,
    ]);
    const assignments = joinDecisionAssignments(space);
    expect(assignments.map((assignment) => assignment.stateIndices)).toEqual([[0, 2], [0, 3], [1]]);
    expect(assignments[2].conditions.map((condition) => condition.variable)).toEqual(["first"]);
  });

  it("unions the paths of a guard side that appears in different commits", () => {
    const space = enumerateStateSpace(
      [[patternHost("initial", [secondBranch()])], [patternHost("updated", [secondBranch()])]],
      undefined,
      [
        { guard: negateGuard(secondGuard), inputs: [secondInput] },
        { guard: secondGuard, inputs: [secondInput] },
      ],
    );
    const side = collectGuardSides(space.tree).find(
      (candidate) => candidate.kind === "branch" && candidate.side === 0,
    );
    expect(side).toBeDefined();
    if (!side) return;
    expect(areGuardsSatisfiable([...side.pathGuards, side.guard])).toBe(true);
  });

  it("counts and reports the cause of a single guarded commit", () => {
    const space = enumerateStateSpace([[patternHost("strong")]], undefined, [firstCause]);
    expect(space.tree.stats.guards).toBe(1);
    expect(collectGuardSides(space.tree)).toMatchObject([{ kind: "commit", guard: firstGuard }]);
  });

  it("unions causes when equal committed patterns are deduplicated", () => {
    const pattern = [patternHost("strong")];
    const space = enumerateStateSpace([pattern, pattern], undefined, [
      firstCause,
      {
        guard: negateGuard(firstGuard),
        inputs: [firstInput],
      },
    ]);
    expect(space.tree.commits).toHaveLength(1);
    expect(space.tree.commits[0].guard).toEqual(constantGuard(true));
    expect(space.stateCount).toBe(1);
  });

  it("neither enumerates nor matches a concrete tree with an impossible cause", () => {
    const space = enumerateStateSpace([[patternHost("strong")]], undefined, [
      { guard: constantGuard(false), inputs: [] },
    ]);
    expect(space.stateCount).toBe(0);
    expect(space.states).toEqual([]);
    expect(
      matchStateSpace(space, [
        { tag: "HostComponent", name: "strong", key: null, text: null, props: {}, children: [] },
      ]).status,
    ).toBe("mismatch");
  });

  it("keeps the initial mount unconditional and unions native retry ancestry", () => {
    const causes = new CommitCauses();
    causes.beginRender(firstCause);
    expect(causes.commit().guard).toEqual(constantGuard(true));
    causes.beginRender(firstCause);
    causes.beginRender({ guard: secondGuard, inputs: [secondInput] });
    expect(causes.commit().guard).toEqual(orGuard([firstGuard, secondGuard]));
  });

  it("does not attribute a delayed task to an unrelated intervening commit", () => {
    const causes = new CommitCauses();
    causes.beginRender();
    const task = causes.run(firstCause, () => causes.bindTask(() => causes.schedule()));
    causes.commit();
    causes.run({ guard: secondGuard, inputs: [secondInput] }, () => causes.schedule());
    causes.beginRender();
    expect(causes.commit().guard).toEqual(secondGuard);
    task();
    causes.beginRender();
    expect(causes.commit().guard).toEqual(firstGuard);
  });
});
