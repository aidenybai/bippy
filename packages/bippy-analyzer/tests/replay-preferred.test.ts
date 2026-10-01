import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { compareStaticToRuntime, enumerateStaticStates } from "../src/harness/compare-render.js";
import { replayEnumeratedStates, replayStateSpace } from "../src/harness/state-replay.js";
import { enumerateStateSpace } from "../src/harness/state-space.js";
import { constantGuard, negateGuard, truthyGuard } from "../src/symbolic/guards.js";
import {
  COMPONENTS_DIRECTORY,
  createComponentRenderer,
  runComponentFixture,
} from "./helpers/component-runner.js";
import {
  anonymousRepeat,
  choiceBranch,
  guardedBranch,
  input,
  patternHost,
} from "./helpers/pattern-builders.js";

const getOutsideComparison = async (filename = "basic-host.tsx") => {
  const filePath = join(COMPONENTS_DIRECTORY, filename);
  const run = await runComponentFixture({ name: filename, filePath });
  const [known] = enumerateStaticStates(run.staticResult).commits;
  const pattern = [choiceBranch("outside", [patternHost("wrong")], known)];
  const space = Object.assign(enumerateStateSpace([pattern], { maxStates: 1, maxRepeat: 2 }), {
    staticPattern: pattern,
    anchor: null,
    unresolved: null,
  });
  const comparison = compareStaticToRuntime(space, run.runtime);
  expect(comparison.matchedState?.index).toBeNull();
  return {
    comparison,
    filePath,
    known,
    runtime: run.runtime,
    renderer: await createComponentRenderer(),
  };
};

it("spends the bounded replay on a matching assignment outside enumeration", async () => {
  const { comparison, filePath, renderer } = await getOutsideComparison();
  const selected: number[] = [];
  const replayed = await replayEnumeratedStates(
    comparison,
    async (pins) => {
      selected.push(pins.branches.get("outside")?.alternativeIndex ?? -1);
      return renderer.derive({ decisions: pins }).renderComponent(filePath);
    },
    { maxReplayed: 1 },
  );
  expect(selected).toEqual([1]);
  expect(replayed.stateReplay?.matchedOutsideEnumeration).toMatchObject({ verification: "passed" });
  expect(replayed.stateReplay?.replayed).toBe(1);
  expect(replayed.stateSpace.states).toEqual(comparison.stateSpace.states);
  expect(replayed.stateSpace.stateCount).toBe(comparison.stateSpace.stateCount);
  expect(replayed.stateSpace.tree).toBe(comparison.stateSpace.tree);
  expect(replayed.matchedState).toEqual(comparison.matchedState);
});

it("reuses compatible commit aliases without adding another assignment", async () => {
  const { known, runtime, filePath, renderer } = await getOutsideComparison();
  const earlier = { ...choiceBranch("earlier", [patternHost("wrong")], known), decision: "shared" };
  const later = { ...choiceBranch("later", [patternHost("wrong")], known), decision: "shared" };
  const space = Object.assign(
    enumerateStateSpace([[earlier], [later]], { maxStates: 2, maxRepeat: 2 }),
    { staticPattern: [later], anchor: null, unresolved: null },
  );
  const comparison = compareStaticToRuntime(space, runtime);
  expect(comparison.matchedState?.index).toBeNull();
  const replayed = await replayEnumeratedStates(
    comparison,
    (decisions) => {
      expect(decisions.branches.get("shared")?.alternativeIndex).toBe(1);
      return renderer.derive({ decisions }).renderComponent(filePath);
    },
    { maxReplayed: 1 },
  );
  expect(replayed.stateReplay?.assignments).toBe(2);
  expect(replayed.stateReplay?.matchedOutsideEnumeration?.verification).toBe("passed");
  expect(replayed.matchedState).toEqual(comparison.matchedState);
});

it("does not reuse an assignment that excludes the matched commit cause", async () => {
  const { known, runtime, renderer } = await getOutsideComparison();
  const filePath = join(COMPONENTS_DIRECTORY, "internal/causal-preferred-probe.tsx");
  renderer.graph.addVirtualModule(filePath, "export default () => <aside />;");
  const earlier = await renderer.derive({ serverComponents: true }).renderComponent(filePath);
  const [before] = enumerateStaticStates(earlier).commits;
  const causeInput = input("cause");
  const cause = truthyGuard({ input: causeInput.id, path: [], measure: "value" });
  const initial = [
    guardedBranch("cause", negateGuard(cause), [causeInput], before, [patternHost("canvas")]),
  ];
  const space = Object.assign(
    enumerateStateSpace([initial, known], { maxStates: 1, maxRepeat: 2 }, [
      { guard: constantGuard(true), inputs: [] },
      { guard: cause, inputs: [causeInput] },
    ]),
    { staticPattern: known, anchor: null, unresolved: null },
  );
  const comparison = compareStaticToRuntime(space, runtime);
  expect(comparison.matchedState?.index).toBeNull();
  const replayed = await replayEnumeratedStates(
    comparison,
    async (decisions) => {
      expect(decisions.branches.size).toBe(0);
      return earlier;
    },
    { maxReplayed: 1 },
  );
  expect(replayed.stateReplay?.matchedOutsideEnumeration?.verification).toBe("incomplete");
  expect(replayed.stateReplay?.mismatched).toEqual([]);
  expect(replayed.matchedState).toEqual(comparison.matchedState);
});

it("pins an observed repeat count beyond the enumeration repeat bound", async () => {
  const { known, runtime, filePath, renderer } = await getOutsideComparison();
  const pattern = [anonymousRepeat("outside-repeat", known, { min: 0, max: 1 })];
  const space = Object.assign(enumerateStateSpace([pattern], { maxStates: 1, maxRepeat: 0 }), {
    staticPattern: pattern,
    anchor: null,
    unresolved: null,
  });
  const comparison = compareStaticToRuntime(space, runtime);
  expect(comparison.matchedState?.index).toBeNull();
  const replayed = await replayEnumeratedStates(
    comparison,
    (decisions) => {
      expect(decisions.repeats.get("outside-repeat")?.iterations).toHaveLength(1);
      return renderer.derive({ decisions }).renderComponent(filePath);
    },
    { maxReplayed: 1 },
  );
  expect(replayed.stateReplay?.matchedOutsideEnumeration?.verification).toBe("passed");
  expect(replayed.stateSpace.budget).toEqual(space.budget);
  expect(replayed.stateSpace.states).toEqual(space.states);
});

it("does not add unindexed replay witnesses to an empty enumeration", async () => {
  const { filePath, renderer } = await getOutsideComparison();
  const space = enumerateStateSpace([[patternHost("wrong")]], { maxStates: 0, maxRepeat: 2 });
  const replayed = await replayStateSpace(space, () => renderer.renderComponent(filePath), null, {
    matchedConditions: [],
  });
  expect(replayed.summary.mismatched).toMatchObject([{ stateIndices: [], isCorrected: false }]);
  expect(replayed.states).toEqual([]);
});

it("does not render an outside match when replay has a zero budget", async () => {
  const { comparison } = await getOutsideComparison();
  const replayed = await replayEnumeratedStates(
    comparison,
    async () => {
      throw new Error("exceeded zero replay budget");
    },
    { maxReplayed: 0 },
  );
  expect(replayed.stateReplay?.matchedOutsideEnumeration).toMatchObject({
    verification: "not-replayed",
  });
  expect(replayed.report).toEqual(comparison.report);
});

it("invalidates a contradicted outside match without rewriting the symbolic model", async () => {
  const { comparison, renderer } = await getOutsideComparison();
  const replayed = await replayEnumeratedStates(
    comparison,
    () => renderer.renderComponent(join(COMPONENTS_DIRECTORY, "timer-callback-arguments.tsx")),
    { maxReplayed: 1 },
  );
  expect(replayed.report.status).toBe("unsound");
  expect(replayed.matchedState).toBeNull();
  expect(replayed.stateReplay?.matchedOutsideEnumeration).toMatchObject({
    verification: "contradicted",
  });
  expect(replayed.stateSpace.states).toEqual(comparison.stateSpace.states);
  expect(replayed.stateSpace.stateCount).toBe(comparison.stateSpace.stateCount);
});

it("keeps an incomplete outside replay distinct from a contradiction", async () => {
  const { comparison, filePath, renderer } = await getOutsideComparison(
    "internal/replay-claim-wildcard.tsx",
  );
  const replayed = await replayEnumeratedStates(
    comparison,
    (pins) => renderer.derive({ decisions: pins }).renderComponent(filePath),
    { maxReplayed: 1 },
  );
  expect(replayed.stateReplay?.matchedOutsideEnumeration).toMatchObject({
    verification: "incomplete",
  });
  expect(replayed.stateReplay?.mismatched).toEqual([]);
  expect(replayed.matchedState).toEqual(comparison.matchedState);
  expect(replayed.report).toEqual(comparison.report);
});

it("does not mistake an unavailable replay tree for a known empty tree", async () => {
  const { comparison, renderer } = await getOutsideComparison();
  const filePath = join(COMPONENTS_DIRECTORY, "internal/unresolved-preferred-probe.tsx");
  renderer.graph.addVirtualModule(
    filePath,
    'import { createElement } from "react"; export default () => createElement(`widget-${Math.random()}`);',
  );
  const unresolved = await renderer.derive({ serverComponents: true }).renderComponent(filePath);
  expect(enumerateStaticStates(unresolved).unresolved).not.toBeNull();
  const replayed = await replayEnumeratedStates(comparison, async () => unresolved, {
    maxReplayed: 1,
  });
  expect(replayed.stateReplay?.matchedOutsideEnumeration?.verification).toBe("incomplete");
  expect(replayed.stateReplay?.mismatched).toEqual([]);
  expect(replayed.report).toEqual(comparison.report);
});

it("replays a real matched update beyond the enumerated commit budget", async () => {
  const filePath = join(COMPONENTS_DIRECTORY, "shared-element-decisions.tsx");
  const run = await runComponentFixture({ name: "shared-element-decisions.tsx", filePath });
  const renderer = await createComponentRenderer();
  const enumerate = { budget: { maxStates: 1 } };
  const comparison = compareStaticToRuntime(
    enumerateStaticStates(run.staticResult, enumerate),
    run.runtime,
  );
  expect(comparison.matchedState?.index).toBeNull();
  const replayed = await replayEnumeratedStates(
    comparison,
    (decisions) => renderer.derive({ decisions }).renderComponent(filePath),
    { maxReplayed: 1, enumerate },
  );
  expect(replayed.stateReplay?.matchedOutsideEnumeration).toMatchObject({ verification: "passed" });
  expect(replayed.stateReplay?.mismatched).toEqual([]);
  expect(replayed.stateReplay?.incomplete).toEqual([]);
  expect(replayed.matchedState).toEqual(comparison.matchedState);
});
