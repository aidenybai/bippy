import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
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

const cases = ["+", "-", "*", "<", ">", "<=", ">=", "==", "==="].flatMap((operator) =>
  outcomes.flatMap((left) =>
    [false, true].map((rightThrows) => {
      const name = `${operator}/left=${left.name}/rightThrows=${rightThrows}`;
      const isKnown = operator !== "==" && operator !== "===";
      const trace = ["left-expression", "right-expression"];
      if (isKnown) {
        const hint = operator === "+" ? "default" : "number";
        trace.push(`left:${hint}`);
        if (left.name === "throws") trace.push("error:left");
        else if (
          left.name === "object" ||
          (left.name === "symbol" && (operator === "-" || operator === "*"))
        )
          trace.push("error:TypeError");
        else {
          trace.push(`right:${hint}`);
          trace.push(
            rightThrows ? "error:right" : left.name === "symbol" ? "error:TypeError" : "after",
          );
        }
      } else trace.push("after");
      return {
        name,
        label: `${isKnown ? "known divergence: " : ""}${name}`,
        isKnown,
        expected: trace.join("|"),
        actual: '"left-expression|right-expression|after"',
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
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);
