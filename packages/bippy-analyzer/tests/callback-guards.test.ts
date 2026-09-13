import { expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

it.each([
  { name: "array-map-closure.tsx", expected: ["1:0", "2:0,2:1"] },
  { name: "array-reduce-closure.tsx", expected: ["1:0", "2:0,2:1"] },
  { name: "array-context-prefix.tsx", expected: ["", "root,child"] },
  { name: "array-generated-prefix.tsx", expected: ["", "root", "root,child"] },
  { name: "array-nested-prefix.tsx", expected: ["", "root,child"] },
  { name: "array-concat-closure.tsx", expected: ["root,child,root,child", "root,root"] },
  { name: "array-call-arguments.tsx", expected: ["1:root,child,root,child", "1:root,root"] },
  { name: "array-optional-arguments.tsx", expected: ["0:none", "1:root,root"] },
])(
  "keeps the selected receiver and closure reads together in $name",
  async ({ name, expected }) => {
    const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
    if (!fixture) throw new Error(`Missing ${name}`);
    const result = await runComponentFixture(fixture);
    const model = enumerateStaticStates(result.staticResult);
    expect(model.omitted).toBeNull();
    const sequences = model.states.map((state) => getConcretePatternText(state.tree).join(","));
    expect([...new Set(sequences)].sort()).toEqual(expected);
    expect(result.comparison.report.status).toBe("exact");
    expect(result.comparison.stateReplay?.mismatched).toEqual([]);
  },
);
