import { beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";
import type { ProjectAnalysis } from "../../src/core/inference/types.js";
import { formatSymbolicValue } from "../../src/core/inference/values.js";
import { getComponent, getFixtureConfig, getWarningKinds } from "./helpers.js";

let project: ProjectAnalysis;

beforeAll(() => {
  project = analyzeProject(getFixtureConfig("mutations"));
});

describe("mutation warnings", () => {
  const getWarnings = (name: string) => getComponent(project, name).analysis.warnings;

  const getUpdateValues = (name: string): string[] =>
    getComponent(project, name).analysis.transitions.flatMap((transition) =>
      transition.updates.map((update) => formatSymbolicValue(update.value)),
    );

  it.each(["LostUpdate", "SortInHandler", "SetAdd"])(
    "reports a lost update when %s mutates state and sets it back",
    (name) => {
      expect(getWarningKinds(getComponent(project, name))).toEqual(["lost-update"]);
      expect(getUpdateValues(name)).toEqual(["Unknown(mutated)"]);
    },
  );

  it.each(["CopyAfterPush", "CopyWithinHandler", "MapStateSet"])(
    "reports in-place state mutation when %s mutates before copying",
    (name) => {
      expect(getWarnings(name)).toMatchObject([
        { kind: "state-mutation", message: expect.stringContaining("in place before setting it") },
      ]);
    },
  );

  it("reports state mutated without being set", () => {
    expect(getWarnings("PushWithoutSet")).toMatchObject([
      { kind: "state-mutation", message: expect.stringContaining("without setting it") },
    ]);
    expect(getUpdateValues("PushWithoutSet")).toEqual(["Unknown(mutated)"]);
  });

  it("reports a destructured array prop sorted during render", () => {
    expect(getWarnings("SortProp")).toMatchObject([
      { kind: "prop-mutation", message: "mutates prop items" },
    ]);
  });

  it("reports a prop mutated in a handler", () => {
    expect(getWarningKinds(getComponent(project, "PropSortInHandler"))).toEqual(["prop-mutation"]);
  });

  it("reports state mutated during render", () => {
    expect(getWarnings("RenderMutation")).toMatchObject([
      { kind: "render-mutation", message: "mutates items during render" },
    ]);
  });

  it.each([
    "Dismiss",
    "MappedList",
    "FilteredCount",
    "SortedCopy",
    "LocalArray",
    "FunctionalUpdate",
    "SortedState",
    "CopyInHandler",
    "PassToFunction",
  ])("reports nothing for %s", (name) => {
    expect(getWarnings(name)).toEqual([]);
  });

  it("keeps a functional update's value", () => {
    expect(getUpdateValues("FunctionalUpdate")).toEqual(['[...items, "next"]']);
  });

  it("still delegates a prop function called with a primitive", () => {
    expect(getComponent(project, "Dismiss").analysis.transitions[0]?.delegates).toEqual([
      "onDismiss",
    ]);
  });

  it("reports two pushes in one handler once, as state mutation", () => {
    expect(getWarningKinds(getComponent(project, "PushTwice"))).toEqual(["state-mutation"]);
  });

  it("reports nested state mutated before a shallow copy", () => {
    expect(getWarningKinds(getComponent(project, "NestedField"))).toEqual(["state-mutation"]);
  });

  it("reports props.items.sort() during render", () => {
    expect(getWarningKinds(getComponent(project, "SortPropsMember"))).toEqual(["prop-mutation"]);
  });
});

describe("mutation forgetting", () => {
  it("forgets state mutated before a copy", () => {
    const copyAfterPush = getComponent(project, "CopyAfterPush");
    const [update] = copyAfterPush.analysis.transitions.flatMap((transition) => transition.updates);
    expect(update?.value).toMatchObject({
      kind: "ArrayExpression",
      elements: [],
      spreads: [{ kind: "Unknown", reason: "mutated" }],
    });
  });

  it("makes the non-empty state reachable from the empty one", () => {
    const { states } = getComponent(project, "CopyAfterPush").report;
    expect(states.map((state) => state.assumptions)).toEqual([
      ["items.length === 0"],
      ["items.length !== 0"],
    ]);
    expect(states[0]?.edges.flatMap((edge) => edge.targets)).toContain(1);
  });
});
