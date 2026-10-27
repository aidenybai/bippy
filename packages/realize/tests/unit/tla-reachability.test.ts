import { dirname, relative } from "node:path";
import { check } from "tla-ts";
import { describe, expect, it } from "vite-plus/test";
import { formatTla } from "../../src/cli/tla";
import { CONDITION_SEPARATOR } from "../../src/core/format";
import type { AnalyzedComponent } from "../../src/core/types";
import { analyzeFixture, getFixtureConfig } from "./helpers";

const ROOT_DIRECTORY = dirname(getFixtureConfig("symbolic-tree"));

const UNREACHABLE_STATES = new Map([
  ["src/expression-defaults.tsx SizeLabel", ["size !== sizes.small ∧ size !== sizes.large"]],
]);

const getComponentId = (component: AnalyzedComponent): string =>
  `${relative(ROOT_DIRECTORY, component.analysis.file)} ${component.analysis.name}`;

const getScreenKey = (outcomes: string[]): string =>
  [...new Set(outcomes.filter(Boolean))].sort().join(",");

const getUnreachableStates = async (component: AnalyzedComponent): Promise<string[]> => {
  const spec = formatTla(component, {
    rootDirectory: ROOT_DIRECTORY,
    moduleName: component.analysis.name,
  });
  const printedScreens: string[] = [];
  const result = await check({
    source: `---- MODULE Reachable ----\nEXTENDS ${spec.moduleName}, TLC\nSeen == Settled => PrintT(Screen)\n====`,
    config: `${spec.config}INVARIANT Seen\n`,
    loadModule: (name) => (name === spec.moduleName ? spec.source : undefined),
    onPrint: (text) => printedScreens.push(text),
  });
  expect(result.status).toBe("success");
  const reachedKeysByRegion = Array.from({ length: spec.regionCount }, () => new Set<string>());
  for (const screen of printedScreens)
    [...screen.matchAll(/"([^"]*)"/g)].forEach((match, regionIndex) =>
      reachedKeysByRegion[regionIndex]?.add(getScreenKey(match[1]?.split(",") ?? [])),
    );
  const branchIndexByKey = new Map(spec.branchKeys.map((key, index) => [key, index + 1]));
  return component.report.states
    .filter((state) => {
      const stateKey = getScreenKey(
        state.branches.map((branch) => {
          const separator = branch.lastIndexOf(":");
          const outcome = branch.slice(separator + 1) === "true" ? "+" : "-";
          return `${branchIndexByKey.get(branch.slice(0, separator))}${outcome}`;
        }),
      );
      return !reachedKeysByRegion[state.regionIndex]?.has(stateKey);
    })
    .map((state) => state.conditions.join(CONDITION_SEPARATOR));
};

describe("TLA+ reachability", () => {
  const components = analyzeFixture("symbolic-tree").components.filter(
    (component) => !component.report.isTruncated,
  );

  it.each(components.map((component) => [getComponentId(component), component] as const))(
    "%s reaches the states realize lists",
    async (componentId, component) => {
      expect(await getUnreachableStates(component)).toEqual(
        UNREACHABLE_STATES.get(componentId) ?? [],
      );
    },
  );
});
