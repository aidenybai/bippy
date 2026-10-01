import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface AllocationExpression {
  name: string;
  source: string;
}

const expressions: AllocationExpression[] = [
  { name: "arrow", source: "() => 7" },
  { name: "anonymous-function", source: "function () { return 7; }" },
  { name: "named-function", source: "function read() { return 7; }" },
  { name: "anonymous-class", source: "class {}" },
  { name: "named-class", source: "class Target {}" },
  { name: "object", source: "{}" },
  { name: "array", source: "[]" },
];

const cases = expressions.flatMap((expression) =>
  [false, true].map((isConditionAllocation) => {
    const name = `${expression.name}/condition=${isConditionAllocation}`;
    const isKnown =
      isConditionAllocation && !["named-class", "object", "array"].includes(expression.name);
    return {
      name,
      label: `${isKnown ? "known divergence: " : ""}${name}`,
      isKnown,
      body: `const created = []; ${isConditionAllocation ? `while (created.push(${expression.source}) < 2) {}` : `while (created.length < 2) { created.push(${expression.source}); }`} return created[0] === created[1];`,
    };
  }),
);

it.each(cases)("$label", ({ name, body, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected: false, actual: "true" }])
    : checkDifferentialCases([{ name, body }]),
);

it.each(differentialSeeds)(
  "matches independently reevaluated class factories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(30);
      const increment = 2 + getRandom(10);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const create = (initial) => class Counter {
        static value = initial;
        static step(amount) { Counter.value += amount; }
        static identity() { return Counter; }
        read() { return Counter.value; }
      };
      const First = create(${initial}); const Second = create(${initial + 20});
      const first = new First(); const second = new Second();
      First.step(${increment});
      return [First !== Second, First.identity() === First, Second.identity() === Second, first.read(), second.read()].join(':');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "distinct arrow allocations remain distinct Set keys",
    body: `const created = []; while (created.push(() => 7) < 2) {} return new Set(created).size;`,
  },
  {
    name: "distinct class allocations remain distinct Map keys",
    body: `const created = []; while (created.push(class {}) < 2) {} const values = new Map(); values.set(created[0], 1); values.set(created[1], 2); return values.size + ':' + values.get(created[0]);`,
  },
  {
    name: "repeated functions have independent own properties",
    body: `const created = []; while (created.push(() => 7) < 2) {} created[0].value = 7; return created[1].value;`,
  },
  {
    name: "repeated classes have independent own static properties",
    body: `const created = []; while (created.push(class { static value = 1; }) < 2) {} created[0].value = 7; return created[1].value;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
