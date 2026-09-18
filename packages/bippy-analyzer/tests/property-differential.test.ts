import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "preserves cached assignment references, coercion and throw order, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const operators = ["=", "+=", "-=", "*=", "&&=", "||=", "??="];
    const inputs = ["undefined", "null", "false", "0", "1", "''", "'old'"];
    const failures = ["none", "B", "K", "G", "R", "S"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 120; index++) {
      const operator = operators[getRandom(operators.length)];
      const initial = inputs[getRandom(inputs.length)];
      const failure = failures[getRandom(failures.length)];
      const reassign = getRandom(2) === 0;
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        let trace = '';
        let stored = ${initial};
        const mark = (phase) => { trace += phase; if (phase === '${failure}') throw phase; };
        const original = {
          get value() { mark('G'); return stored; },
          set value(value) { mark('S'); stored = value; }
        };
        const replacement = { value: 'replacement' };
        let holder = original;
        const base = () => { mark('B'); return holder; };
        const key = () => { mark('K'); return 'value'; };
        const right = () => { mark('R'); ${reassign ? "holder = replacement;" : ""} return 7; };
        let outcome;
        try { outcome = base()[key()] ${operator} right(); }
        catch (error) { outcome = 'caught:' + error; }
        return String(outcome) + '|' + trace + '|' + String(stored) + '|' + replacement.value + '|' + (holder === original);
      `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

interface PropertyCase extends DifferentialCase {
  knownDivergence: boolean;
}

const createOptionalCases = (): PropertyCase[] => {
  const cases: PropertyCase[] = [];
  for (const receiver of ["null", "undefined", "object"]) {
    for (const expression of [
      "target?.[key()]",
      "target?.method(argument())",
      "target?.method?.(argument())",
      "(target?.method)(argument())",
      "delete target?.[key()]",
      "target?.missing?.[key()]",
    ]) {
      cases.push({
        name: `${receiver}/${expression}`,
        knownDivergence:
          (receiver !== "object" && expression === "(target?.method)(argument())") ||
          (receiver === "object" && expression === "delete target?.[key()]"),
        body: `
          let trace = '';
          const object = { value: 4, method: (value) => { trace += 'M'; return value; } };
          const target = ${receiver};
          const key = () => { trace += 'K'; return 'value'; };
          const argument = () => { trace += 'A'; return 7; };
          let result;
          try { result = ${expression}; } catch (error) { result = error.name; }
          return String(result) + '|' + trace + '|' + ('value' in object);
        `,
      });
    }
  }
  return cases;
};

const createDestructuringCases = (): PropertyCase[] => {
  const cases: PropertyCase[] = [];
  for (const value of ["undefined", "null", "false", "0", "''", "'present'"]) {
    for (const failure of ["none", "G", "D", "H"]) {
      cases.push({
        name: `${value}/${failure}`,
        knownDivergence:
          failure === "G" || value === "null" || (value === "undefined" && failure === "D"),
        body: `
          let trace = '';
          const mark = (phase) => { trace += phase; if (phase === '${failure}') throw phase; };
          const source = { get first() { mark('G'); return ${value}; }, get second() { mark('H'); return 8; } };
          const fallback = () => { mark('D'); return 7; };
          let outcome;
          try { const { first = fallback(), second } = source; outcome = String(first) + ':' + second; }
          catch (error) { outcome = 'caught:' + error; }
          return outcome + '|' + trace;
        `,
      });
    }
  }
  return cases;
};

describe.each([
  { name: "optional chain boundaries", cases: createOptionalCases() },
  { name: "destructuring default and getter order", cases: createDestructuringCases() },
])("$name", ({ cases }) => {
  it.each(cases.filter((testCase) => !testCase.knownDivergence))("$name", (testCase) =>
    checkDifferentialCases([testCase]),
  );
  it.fails.each(cases.filter((testCase) => testCase.knownDivergence))(
    "known divergence: $name",
    (testCase) => checkDifferentialCases([testCase]),
  );
});
