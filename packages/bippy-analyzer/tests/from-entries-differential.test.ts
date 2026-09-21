import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const keys = [
  "'first'",
  "'2'",
  "'first'",
  "'__proto__'",
  "'constructor'",
  "true",
  "null",
  "undefined",
  "3n",
  "-0",
  "'0'",
];

it.each(differentialSeeds)(
  "matches order-normalized entry snapshots and value aliases, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const length = 3 + (index % 6);
      const counts = Array.from({ length }, () => getRandom(30));
      const pairs = counts.map(
        (_count, entryIndex) =>
          `[${keys[(index + entryIndex) % keys.length]}, values[${entryIndex}]]`,
      );
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const values = [${counts.map((count) => `{ count: ${count} }`).join(",")}]; const pairs = [${pairs.join(",")}]; const result = Object.fromEntries(${index % 2 ? "new Map(pairs)" : "pairs"}); pairs[0][1] = { count: -1 }; values[${length - 1}].count += 100; return Object.keys(result).sort().map((key) => key + ':' + result[key].count).join('|') + '#' + (Object.getPrototypeOf(result) === Object.prototype);`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const cases = [
  {
    name: "missing pair value",
    body: `const result = Object.fromEntries([['value']]); return Object.hasOwn(result, 'value') + ':' + result.value;`,
  },
  {
    name: "empty pair defaults both indexed reads",
    body: `const result = Object.fromEntries([[]]); return Object.hasOwn(result, 'undefined');`,
  },
  { name: "hole key becomes undefined", body: `return Object.fromEntries([[, 7]]).undefined;` },
  {
    name: "object pair supplies indexed properties",
    expected: 7,
    actual: 'unknown(unresolved descriptor for "value")',
    body: `return Object.fromEntries([{ 0: 'value', 1: 7 }]).value;`,
  },
  {
    name: "missing object key becomes undefined",
    expected: 7,
    actual: 'unknown(unresolved descriptor for "undefined")',
    body: `return Object.fromEntries([{ 1: 7 }]).undefined;`,
  },
  {
    name: "function pair supplies indexed properties",
    expected: 7,
    actual: 'unknown(unresolved descriptor for "value")',
    body: `const pair = () => {}; pair[0] = 'value'; pair[1] = 7; return Object.fromEntries([pair]).value;`,
  },
  {
    name: "symbol keys remain symbols",
    body: `const key = Symbol('entry'); return Object.fromEntries([[key, 7]])[key] === 7;`,
  },
  {
    name: "empty string input is an empty iterable",
    body: `return Object.keys(Object.fromEntries('')).length;`,
  },
  {
    name: "ordinary fields have full data flags",
    body: `const result = Object.fromEntries([['value', 7]]); const descriptor = Object.getOwnPropertyDescriptor(result, 'value'); return [descriptor.value, descriptor.enumerable, descriptor.writable, descriptor.configurable].join(':');`,
  },
  {
    name: "inherited-name keys are own data without changing the prototype",
    body: `const value = {}; const result = Object.fromEntries([['__proto__', value]]); return Object.hasOwn(result, '__proto__') + ':' + (result.__proto__ === value) + ':' + (Object.getPrototypeOf(result) === Object.prototype);`,
  },
];

it.each(
  cases.map((testCase) => ({
    label: `${testCase.actual === undefined ? "" : "known precision gap: "}${testCase.name}`,
    testCase,
  })),
)("$label", ({ testCase }) => {
  if (testCase.actual !== undefined) {
    const { name, body, expected, actual } = testCase;
    return checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
  }
  return checkDifferentialCases([testCase]);
});

it.each(["'entry'", "7", "null", "undefined", "false", "7n", "Symbol('entry')"])(
  "known divergence: rejects primitive entry %s",
  (entry) =>
    checkKnownDifferentialWitnesses([
      {
        name: `primitive/${entry}`,
        expected: "TypeError",
        actual: '"after"',
        body: `try { Object.fromEntries([${entry}]); return 'after'; } catch (error) { return error.name; }`,
      },
    ]),
);
