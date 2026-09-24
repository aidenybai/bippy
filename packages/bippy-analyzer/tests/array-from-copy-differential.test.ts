import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [
  {
    name: "independent calls and explicit undefined mapper",
    body: `const source = firstValue ? [1] : []; const left = Array.from(source); const right = Array.from(source, undefined); if (secondValue) left.push(9); return [source === left, left === right, source.join(','), left.join(','), right.join(',')].join('|');`,
  },
  {
    name: "shallow object identity",
    body: `const item = {value: firstValue ? 1 : 2}; const source = [item]; const copy = Array.from(source); if (secondValue) copy[0].value = 9; return [copy !== source, copy[0] === item, source[0].value, copy[0].value].join('|');`,
  },
  {
    name: "shallow nested array identity",
    body: `const item = [firstValue ? 1 : 2]; const source = [item]; const copy = Array.from(source); if (secondValue) copy[0].push(9); return [copy !== source, copy[0] === item, source[0].join(','), copy[0].join(',')].join('|');`,
  },
  {
    name: "does not copy non-index properties",
    body: `const source = [firstValue ? 1 : 2]; source.extra = 7; source[Symbol.for('extra')] = 9; const copy = Array.from(source); if (secondValue) copy.push(3); return [Object.keys(copy).join(','), Object.getOwnPropertySymbols(copy).length, typeof copy.extra, Object.getPrototypeOf(copy) === Array.prototype].join('|');`,
  },
  {
    name: "frozen input produces a mutable copy",
    body: `const source = Object.freeze([1]); const copy = Array.from(source); if (firstValue) copy.push(2); if (secondValue) copy[0] = 3; return [Object.isFrozen(source), Object.isFrozen(copy), source.join(','), copy.join(',')].join('|');`,
  },
  {
    name: "argument copy and source mutations",
    body: `return ({read() { const copy = Array.from(arguments); if (firstValue) copy.pop(); if (secondValue) arguments[0] = 9; return [copy === arguments, arguments.length, copy.join(','), Array.from(arguments).join(',')].join('|'); }}).read(1,2);`,
  },
  {
    name: "array-like shallow copy",
    body: `const item = {value: firstValue ? 1 : 2}; const source = {0:item,1:2,length:2,extra:3}; const copy = Array.from(source); if (secondValue) copy[0].value = 9; return [Array.isArray(copy), copy[0] === source[0], source[0].value, copy.length, typeof copy.extra].join('|');`,
  },
  {
    name: "selected source and copied array have independent storage",
    body: `const source = firstValue ? [1,2] : [3]; const copy = Array.from(source); if (firstValue) copy.push(9); if (secondValue) source.pop(); return [source === copy, source.join(','), copy.join(',')].join('|');`,
  },
].map((testCase) => ({
  ...testCase,
  body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
}));

it.each(cases)("matches native copy surfaces and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete copy-surface inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
