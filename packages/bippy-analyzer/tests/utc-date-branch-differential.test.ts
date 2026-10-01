import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const mutations = [
  "setTime(1000)",
  "setUTCFullYear(2000, 1, 29)",
  "setUTCMonth(13, 0)",
  "setUTCDate(-2)",
  "setUTCHours(25, 61, 62, 1001)",
  "setUTCMinutes(-1)",
  "setUTCSeconds(61)",
  "setUTCMilliseconds(-1)",
  "setTime(NaN)",
  "setTime(8640000000000001)",
];

const cases: DifferentialCase[] = mutations.flatMap((mutation) =>
  [0, 1582934400123].flatMap((initial) =>
    [false, true].map((earlyReturn) => ({
      name: `${mutation}/initial=${initial}/early=${earlyReturn}`,
      body: `
        const original = new Date(${initial});
        const alias = original;
        const copy = new Date(original);
        const iso = () => { try { return original.toISOString(); } catch (error) { return error.name; } };
        const snapshot = () => original.getTime() + '#' + alias.valueOf() + '#' + (+original) + '#' + copy.getTime() + '#' + iso() + '#' + original.getUTCMonth() + '#' + (alias === original) + '#' + (copy === original);
        if (first) { alias.${mutation}; ${earlyReturn ? "return 'early:' + snapshot();" : ""} }
        if (second) original.setTime(86400000);
        return 'late:' + snapshot();
      `,
    })),
  ),
);

const additionalCases: DifferentialCase[] = [
  {
    name: "multiple setter arguments retain their input guards",
    body: `const inputFirst = first; const inputSecond = second; const value = new Date(0); value.setUTCFullYear(inputFirst ? 2000 : 2001, inputSecond ? 0 : 1); return (inputFirst ? 'T' : 'F') + ':' + (inputSecond ? 'T' : 'F') + ':' + value.toISOString();`,
  },
  {
    name: "multiple constructor arguments retain their input guards",
    body: `const inputFirst = first; const inputSecond = second; const value = new Date(inputFirst ? 2000 : 2001, inputSecond ? 0 : 1, 1); return (inputFirst ? 'T' : 'F') + ':' + (inputSecond ? 'T' : 'F') + ':' + value.getTime();`,
  },
  {
    name: "setting a guarded date from itself preserves its timestamp",
    body: `const inputFirst = first; const inputSecond = second; const value = new Date(0); if (inputFirst) value.setTime(1000); if (inputSecond) value.setTime(2000); value.setTime(value); return (inputFirst ? 'T' : 'F') + ':' + (inputSecond ? 'T' : 'F') + ':' + value.getTime();`,
  },
  {
    name: "copy a guarded timestamp before overwriting its source",
    body: `const original = new Date(0); if (first) original.setTime(1000); if (second) original.setTime(2000); const copy = new Date(original); original.setTime(3000); return copy.getTime() + ':' + original.getTime() + ':' + (copy === original);`,
  },
  {
    name: "finite setter arguments retain independent conditions",
    body: `const value = new Date(0); value.setTime(first ? 1000 : 2000); if (second) value.setUTCSeconds(10); return value.getTime() + ':' + value.toISOString();`,
  },
  {
    name: "finite constructor arguments retain their condition",
    body: `const value = new Date(first ? 0 : 1000); if (second) value.setTime(2000); return value.getTime() + ':' + value.valueOf();`,
  },
  {
    name: "date arguments retain timestamp correlations",
    body: `const original = new Date(0); if (first) original.setTime(1000); const copy = new Date(0); copy.setTime(original); if (second) original.setTime(2000); return copy.getTime() + ':' + original.getTime();`,
  },
  {
    name: "invalid date recovery preserves the untouched branch",
    body: `const value = new Date(NaN); if (first) value.setUTCFullYear(2000); if (second) value.setTime(0); return String(value.getTime()) + ':' + value.toJSON();`,
  },
];

it.each([...cases, ...additionalCases])("matches concrete date inputs for $name", (testCase) =>
  checkDifferentialCases(
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/${first}/${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
);

it.each([...cases, ...additionalCases])(
  "preserves date state through native comparison and replay for $name",
  (testCase) => checkSymbolicCases([testCase]),
);
