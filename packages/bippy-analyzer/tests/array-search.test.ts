import { expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

it.each([
  {
    name: "array-search-order.tsx",
    expected: ["find:2:1,2|findIndex:1:1,2|findLast:2:3,2|findLastIndex:1:3,2"],
  },
  { name: "array-search-guarded-count.tsx", expected: ["first:0:1", "later:1:2"] },
  { name: "array-search-throws.tsx", expected: ["search failed:1"] },
  { name: "array-search-mutations.tsx", expected: ["9:1,9:1,9,3,4"] },
  { name: "array-search-receiver.tsx", expected: ["2:2"] },
  { name: "array-search-length.tsx", expected: ["missing:2:2"] },
  { name: "array-search-guarded-throw.tsx", expected: ["1:1", "caught:1"] },
])("preserves native search outcomes for $name", async ({ name, expected }) => {
  const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Missing ${name}`);
  const result = await runComponentFixture(fixture);
  const model = enumerateStaticStates(result.staticResult);
  expect(model.omitted).toBeNull();
  expect(
    [...new Set(model.states.map((state) => getConcretePatternText(state.tree).join("|")))].sort(),
  ).toEqual(expected);
  expect(result.comparison.report.status).toBe("exact");
  expect(result.comparison.stateReplay?.mismatched).toEqual([]);
});
