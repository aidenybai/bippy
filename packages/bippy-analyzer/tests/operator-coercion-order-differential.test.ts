import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches explicit conversion-hook calls and primitive arithmetic, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const other = getRandom(30);
      const increment = 1 + getRandom(10);
      const operator = ["+", "-", "*", "<", ">"][index % 5];
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const left = { name: 'left', value: ${initial}, [Symbol.toPrimitive](hint) { trace.push(this.name + ':' + hint); right.value += ${increment}; return this.value; } };
      const right = { name: 'right', value: ${other}, [Symbol.toPrimitive](hint) { trace.push(this.name + ':' + hint); return this.value; } };
      const convertedLeft = left[Symbol.toPrimitive]('number');
      const convertedRight = right[Symbol.toPrimitive]('number');
      return trace.join('|') + '#' + (convertedLeft ${operator} convertedRight);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

interface CoercionOutcome {
  name: string;
  source: string;
}

const outcomes: CoercionOutcome[] = [
  { name: "number", source: "return 7;" },
  { name: "throws", source: "throw 'left';" },
  { name: "object", source: "return {};" },
  { name: "symbol", source: "return Symbol('left');" },
];

const cases: DifferentialCase[] = ["+", "-", "*", "<", ">", "<=", ">=", "==", "==="].flatMap(
  (operator) =>
    outcomes.flatMap((left) =>
      [false, true].map((rightThrows) => ({
        name: `${operator}/left=${left.name}/rightThrows=${rightThrows}`,
        body: `
    const trace = [];
    const left = { [Symbol.toPrimitive](hint) { trace.push('left:' + hint); ${left.source} } };
    const right = { [Symbol.toPrimitive](hint) { trace.push('right:' + hint); ${rightThrows ? "throw 'right';" : "return 3;"} } };
    const getLeft = () => { trace.push('left-expression'); return left; };
    const getRight = () => { trace.push('right-expression'); return right; };
    try { getLeft() ${operator} getRight(); trace.push('after'); }
    catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); }
    return trace.join('|');
  `,
      })),
    ),
);

it.each(cases)("matches native ToPrimitive order: $name", (testCase) =>
  checkDifferentialCases([testCase]),
);
