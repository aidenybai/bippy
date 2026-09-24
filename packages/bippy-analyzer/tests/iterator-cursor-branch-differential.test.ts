import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface IteratorFactory {
  name: string;
  expression: (values: number[]) => string;
}

const factories: IteratorFactory[] = [
  {
    name: "generator",
    expression: (values) =>
      `({ *items() { yield* ${JSON.stringify(values)}; return 99; } }).items()`,
  },
  ...["keys", "values", "entries"].map((method) => ({
    name: `Map.${method}`,
    expression: (values: number[]) =>
      `new Map(${JSON.stringify(values.map((value) => [value, value + 1]))}).${method}()`,
  })),
  ...["keys", "values", "entries"].map((method) => ({
    name: `Set.${method}`,
    expression: (values: number[]) => `new Set(${JSON.stringify(values)}).${method}()`,
  })),
];

const campaigns = factories.map((factory) => ({
  name: factory.name,
  cases: [0, 1, 2, 3].flatMap((length): DifferentialCase[] => {
    const prefix = `const iterator = ${factory.expression(Array.from({ length }, (_, index) => 10 + index))}; const alias = iterator; const step = () => { const result = alias.next(); return String(result.value) + ':' + result.done; };`;
    return [
      {
        name: `${factory.name}/length=${length}/steps`,
        body: `${prefix} if (first) iterator.next(); if (second) alias.next(); return step() + '|' + step();`,
      },
      {
        name: `${factory.name}/length=${length}/drain`,
        body: `${prefix} if (first) Array.from(alias); if (second) iterator.next(); return step() + '|' + step();`,
      },
      {
        name: `${factory.name}/length=${length}/early`,
        body: `${prefix} if (first) { iterator.next(); return 'early:' + step(); } if (second) Array.from(alias); return 'late:' + step();`,
      },
    ];
  }),
}));

campaigns.push({
  name: "fork-local allocation",
  cases: [
    {
      name: "cursor allocated inside a fork retains its advancement",
      body: `const factory = { *items() { yield 10; yield 20; } }; let iterator; if (first) { iterator = factory.items(); iterator.next(); } else { iterator = factory.items(); } if (second) iterator.next(); return String(iterator.next().value);`,
    },
    {
      name: "a cursor allocated in a called closure belongs to its fork",
      body: `const factory = { *items() { yield 10; yield 20; } }; const create = () => factory.items(); let iterator; if (first) { iterator = create(); iterator.next(); } else { iterator = create(); } return String(iterator.next().value);`,
    },
  ],
});

it.each(campaigns)("matches concrete shared-cursor inputs for $name", ({ cases }) =>
  checkDifferentialCases(
    cases.flatMap((testCase) =>
      [false, true].flatMap((first) =>
        [false, true].map((second) => ({
          name: `${testCase.name}/${first}/${second}`,
          body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
        })),
      ),
    ),
  ),
);

it.each(campaigns)("preserves shared cursor predicates through replay for $name", ({ cases }) =>
  checkSymbolicCases(cases),
);

it.each(["JSON.stringify(iterator)", "structuredClone(iterator)"])(
  "does not advance an iterator while inspecting it with %s",
  (expression) =>
    checkDifferentialCases([
      {
        name: expression,
        body: `const iterator = ({ *items() { yield 10; yield 20; } }).items(); try { ${expression}; } catch {} return String(iterator.next().value);`,
      },
    ]),
);
