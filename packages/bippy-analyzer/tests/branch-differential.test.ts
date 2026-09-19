import { expect, it } from "vite-plus/test";
import { getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getObjectProperty } from "../src/evaluate/values.js";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  evaluateCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches all four native executions of correlated branches, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const initial = getRandom(10);
      const increment = 1 + getRandom(10);
      const multiplier = 2 + getRandom(4);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const left = { value: ${initial} };
        const right = { value: ${initial + 1} };
        const target = first ? left : right;
        target.value = second ? ${increment} : ${multiplier};
        return left.value + ':' + right.value;
      `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it.each([
  {
    name: "writes through a branched alias remain on the selected object",
    body: `const left = { value: 0 }; const right = { value: 1 }; const target = first ? left : right; target.value = second ? 2 : 3; return left.value + ':' + right.value;`,
  },
  {
    name: "a throwing path retains only the mutations before its throw",
    body: `const state = { value: 0 }; let trace = ''; try { state.value = first ? 1 : 2; if (second) throw 'stop'; state.value += 10; trace += 'R'; } catch (error) { trace += 'C'; } return state.value + ':' + trace;`,
  },
  {
    name: "deleting a branched key does not delete both keys",
    body: `const state = { left: 1, right: 2 }; const key = first ? 'left' : 'right'; delete state[key]; return ('left' in state) + ':' + ('right' in state);`,
  },
])("$name", async (testCase) => checkSymbolicCases([testCase]));

it("keeps a branched member read correlated with its index", async () => {
  const [result] = await evaluateCases(
    [
      {
        name: "branched member index",
        body: `const values = ['left', 'right']; const index = first ? 0 : 1; return { index, value: values[index] };`,
      },
    ],
    "declare const first: boolean;\n",
  );
  expect(result?.kind).toBe("object");
  if (result?.kind !== "object") throw new Error("Expected an object result");
  const index = getObjectProperty(result, "index");
  const value = getObjectProperty(result, "value");
  expect(index.kind).toBe("branch");
  expect(value.kind).toBe("branch");
  if (index.kind !== "branch" || value.kind !== "branch")
    throw new Error("Expected branched properties");
  expect(getAlternativeGuards(value)).toEqual(getAlternativeGuards(index));
});

it("reuses an unknown member index guard across list reads", async () => {
  const [result] = await evaluateCases(
    [
      {
        name: "unknown member index",
        body: `const values = ['left', 'right']; const dynamicIndex = index; return { first: values[dynamicIndex], second: values[dynamicIndex] };`,
      },
    ],
    "declare const index: number;\n",
  );
  expect(result?.kind).toBe("object");
  if (result?.kind !== "object") throw new Error("Expected an object result");
  const first = getObjectProperty(result, "first");
  const second = getObjectProperty(result, "second");
  expect(first.kind).toBe("branch");
  expect(second.kind).toBe("branch");
  if (first.kind !== "branch" || second.kind !== "branch")
    throw new Error("Expected branched properties");
  expect(getAlternativeGuards(first)).toEqual(getAlternativeGuards(second));
});

it("reuses an unknown index guard with an indefinite list tail", async () => {
  const [result] = await evaluateCases(
    [
      {
        name: "indefinite list tail",
        body: `const values = ['left']; if (first) values.push('right'); const dynamicIndex = index; return { first: values[dynamicIndex], second: values[dynamicIndex] };`,
      },
    ],
    "declare const first: boolean;\ndeclare const index: number;\n",
  );
  expect(result?.kind).toBe("object");
  if (result?.kind !== "object") throw new Error("Expected an object result");
  const first = getObjectProperty(result, "first");
  const second = getObjectProperty(result, "second");
  expect(first.kind).toBe("branch");
  expect(second.kind).toBe("branch");
  if (first.kind !== "branch" || second.kind !== "branch")
    throw new Error("Expected branched properties");
  expect(getAlternativeGuards(first)).toEqual(getAlternativeGuards(second));
});

it.fails.each([
  {
    name: "arithmetic retains the predicates connecting values and labels",
    body: `const state = { value: 2 }; if (first) state.value += 3; else state.value -= 3; return (second ? state.value * 5 : state.value + 5) + ':' + (first ? 'A' : 'B') + ':' + (second ? 'C' : 'D');`,
  },
  {
    name: "a finalizer preserves the correlation between its write and the return value",
    body: `const state = { value: 0 }; const run = () => { try { if (first) throw 'stop'; return second ? 'left' : 'right'; } finally { state.value = second ? 7 : 8; } }; let result; try { result = run(); } catch (error) { result = 'caught'; } return result + ':' + state.value;`,
  },
])("known precision gap: $name", (testCase) => checkSymbolicCases([testCase]));
