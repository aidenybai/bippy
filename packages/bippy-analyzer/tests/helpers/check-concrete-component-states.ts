import { expect } from "vite-plus/test";
import { enumerateStaticStates } from "../../src/harness/compare-render.js";
import { listComponentFixtures, runComponentFixture } from "./component-runner.js";
import { getConcretePatternText } from "./concrete-pattern-text.js";

export const checkConcreteComponentStates = async (
  name: string,
  expected: readonly string[],
  separator = "|",
): Promise<void> => {
  const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Missing ${name}`);
  const result = await runComponentFixture(fixture);
  const model = enumerateStaticStates(result.staticResult);
  expect(model.omitted).toBeNull();
  const sequences = model.states.map((state) => getConcretePatternText(state.tree).join(separator));
  expect([...new Set(sequences)].sort()).toEqual(expected);
  expect(result.comparison.report.status, JSON.stringify(result.comparison.report)).toBe("exact");
  expect(result.comparison.stateReplay?.mismatched).toEqual([]);
};
