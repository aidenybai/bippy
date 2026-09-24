import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [
  ...[[], [1], [1, 2]].map((items) => ({
    name: `apply arguments and returned array have independent storage, length ${items.length}`,
    body: `const source = ${JSON.stringify(items)}; const copy = Array.of.apply(Array, source); if (firstValue) source.push(7); if (secondValue) copy.push(9); return [source.join(','), copy.join(','), source === copy, Array.isArray(copy)].join('|');`,
  })),
  {
    name: "Reflect.apply argument storage is not retained",
    body: `const source = [1,2]; const copy = Reflect.apply(Array.of, Array, source); if (firstValue) source[0] = 7; if (secondValue) copy[1] = 9; return [source.join(','), copy.join(','), source === copy].join('|');`,
  },
  {
    name: "independent calls do not share their argument storage",
    body: `const source = [1,2]; const left = Array.of.apply(null, source); const right = Array.of.apply(undefined, source); if (firstValue) left.push(7); if (secondValue) right[0] = 9; return [source.join(','), left.join(','), right.join(','), left === right].join('|');`,
  },
  {
    name: "frozen apply arguments produce a mutable independent array",
    body: `const source = Object.freeze([1]); const copy = Array.of.apply(Array, source); if (firstValue) copy.push(7); if (secondValue) copy[0] = 9; return [source.join(','), copy.join(','), Object.isFrozen(source), Object.isFrozen(copy)].join('|');`,
  },
  {
    name: "copied arguments retain shallow payload aliases",
    body: `const item = {value:firstValue ? 1 : 2}; const source = [item]; const copy = Array.of.apply(Array, source); if (secondValue) copy[0].value = 9; return [source === copy, copy[0] === item, source[0].value, copy[0].value].join('|');`,
  },
  {
    name: "ordinary spread construction remains an independent copy",
    body: `const source = [1,2]; const copy = Array.of(...source); if (firstValue) source.push(7); if (secondValue) copy[0] = 9; return [source.join(','), copy.join(','), source === copy].join('|');`,
  },
].map((testCase) => ({
  ...testCase,
  body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
}));

it.each(cases)("matches native Array.of copying and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete Array.of copy inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
