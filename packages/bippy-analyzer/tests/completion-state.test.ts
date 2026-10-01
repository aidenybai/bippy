import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

const cases = [
  {
    name: "nested scalar return excludes a later write",
    body: `let value = 0;
      if (first) { value = 1; if (second) return String(value); } else { value = 2; }
      if (second) value += 3; return String(value);`,
  },
  {
    name: "nested object return excludes a later write",
    body: `const state = { value: 0 }; const alias = state;
      const run = () => {
        if (first) { state.value = 1; if (second) return "early"; } else { state.value = 2; }
        if (second) state.value += 3; return "late";
      }; return run() + ":" + alias.value;`,
  },
  {
    name: "nested return keeps captured lexical state",
    body: `let value = 0; const read = () => value;
      const run = () => {
        if (first) { value = 1; if (second) return "early"; } else { value = 2; }
        if (second) value += 3; return "late";
      }; return run() + ":" + read();`,
  },
  {
    name: "nested return preserves a returned closure's locals",
    body: `const run = () => {
        let value = 0; const read = () => value;
        if (first) { value = 1; if (second) return read; } else { value = 2; }
        if (second) value += 3; return read;
      }; return String(run()());`,
  },
  {
    name: "nested static return excludes a later write",
    body: `class Counter { static value = 0; static add(value) { this.value += value; } }
      const run = () => {
        if (first) { Counter.add(1); if (second) return "early"; } else { Counter.add(2); }
        if (second) Counter.add(3); return "late";
      }; return run() + ":" + Counter.value;`,
  },
  {
    name: "nested private static return excludes a later write",
    body: `class Counter { static #value = 0; static add(value) { this.#value += value; }
        static read() { return this.#value; } }
      const run = () => {
        if (first) { Counter.add(1); if (second) return "early"; } else { Counter.add(2); }
        if (second) Counter.add(3); return "late";
      }; return run() + ":" + Counter.read();`,
  },
  {
    name: "a catch sees only writes preceding its nested throw",
    body: `const state = { value: 0 };
      try {
        if (first) { state.value = 1; if (second) throw "early"; } else { state.value = 2; }
        if (second) state.value += 3; return "late:" + state.value;
      } catch (error) { return error + ":" + state.value; }`,
  },
  {
    name: "finally applies once to the selected nested exit",
    body: `const state = { value: 0 };
      const run = () => { try {
        if (first) { state.value = 1; if (second) return "early"; } else { state.value = 2; }
        if (second) state.value += 3; return "late";
      } finally { state.value += 10; } };
      return run() + ":" + state.value;`,
  },
];

it.each(cases)("preserves completion state: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
