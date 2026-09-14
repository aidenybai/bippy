import { it } from "vite-plus/test";
import { checkSymbolicCases, createSeededRandom, differentialSeeds, type DifferentialCase } from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)("matches all four native executions of correlated branches, seed %i", async (seed) => {
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
});

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
