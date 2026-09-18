import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface CallbackMethod {
  method: string;
  knownDivergences: string[];
}

const methods: CallbackMethod[] = [
  { method: "map", knownDivergences: ["truncate", "delete", "throw"] },
  { method: "filter", knownDivergences: ["delete", "throw"] },
  { method: "forEach", knownDivergences: ["delete", "throw"] },
  { method: "some", knownDivergences: ["delete"] },
  { method: "every", knownDivergences: ["delete"] },
  { method: "find", knownDivergences: [] },
  { method: "findIndex", knownDivergences: [] },
  { method: "findLast", knownDivergences: [] },
  { method: "findLastIndex", knownDivergences: [] },
  { method: "reduce", knownDivergences: ["append", "delete"] },
  { method: "reduceRight", knownDivergences: ["overwrite", "truncate", "delete"] },
];
const mutations: Record<string, string> = {
  none: "",
  append: "array.push(99);",
  overwrite: "array[1] = 99;",
  truncate: "array.length = 1;",
  delete: "delete array[1];",
  throw: "throw new Error('callback');",
};

const createCallbackCase = (
  method: string,
  mutation: string,
  values: number[],
  trigger: number,
): DifferentialCase => {
  const isReduce = method === "reduce" || method === "reduceRight";
  const result = isReduce
    ? "total + (value ?? 0)"
    : method === "map"
      ? "value * 2"
      : method === "every"
        ? "value !== 99"
        : "value === 99";
  return {
    name: `${method}/${mutation}/${values.join(",")}/trigger=${trigger}`,
    body: `
      const array = [${values.join(",")}];
      const visited = [];
      let outcome;
      try {
        const result = array.${method}((${isReduce ? "total, " : ""}value, index) => {
          visited.push(index + ':' + value);
          if (index === ${trigger}) { ${mutations[mutation]} }
          return ${result};
        }${isReduce ? ", 0" : ""});
        outcome = String(result);
      } catch (error) { outcome = 'caught:' + error.message; }
      return outcome + '|' + visited.join(',') + '|' + array.join(',') + '|' + array.length;
    `,
  };
};

const checkCallbacks = async (method: string, mutation: string): Promise<void> =>
  checkDifferentialCases([
    createCallbackCase(method, mutation, [1, 2, 3], 0),
    createCallbackCase(method, mutation, [3, 1, 2], 2),
    createCallbackCase(method, mutation, [], 0),
  ]);

describe.each(methods)("native $method callback semantics", ({ method, knownDivergences }) => {
  it.each(Object.keys(mutations).filter((mutation) => !knownDivergences.includes(mutation)))(
    "matches %s mutation and callback traces",
    (mutation) => checkCallbacks(method, mutation),
  );
  it.fails.each(knownDivergences)("known divergence: %s mutation and callback traces", (mutation) =>
    checkCallbacks(method, mutation),
  );
});

it.each(differentialSeeds)(
  "matches native dense array searches at integral boundaries, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const indices = ["Infinity", "-Infinity", "0", "-0", "1", "-1", "-9", "9"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 60; index++) {
      const values = Array.from({ length: getRandom(7) }, () => getRandom(4));
      const fromIndex = indices[getRandom(indices.length)];
      const search = getRandom(4);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const values = [${values.join(",")}]; return values.indexOf(${search}, ${fromIndex}) + ':' + values.includes(${search}, ${fromIndex}) + ':' + values.at(${fromIndex});`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.fails.each(["NaN", "1.8", "-1.8"])(
  "known divergence: indexOf normalizes %s to an integer offset",
  (fromIndex) =>
    checkDifferentialCases([
      { name: `indexOf(${fromIndex})`, body: `return [1, 1, 1].indexOf(1, ${fromIndex});` },
    ]),
);

it.fails.each(["undefined", "null", "true", "false", "'1'"])(
  "known precision gap: array searches coerce %s",
  (fromIndex) =>
    checkDifferentialCases([
      {
        name: `search(${fromIndex})`,
        body: `return [1, 1, 1].indexOf(1, ${fromIndex}) + ':' + [1, 1, 1].includes(1, ${fromIndex});`,
      },
    ]),
);

it.fails("known divergence: includes uses SameValueZero for NaN", () =>
  checkDifferentialCases([{ name: "includes(NaN)", body: "return [NaN].includes(NaN);" }]));

it.each(differentialSeeds)(
  "matches native mutation sequences and return values through aliases, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 60; index++) {
      const values = Array.from({ length: getRandom(7) }, () => getRandom(11) - 5);
      const expressions: string[] = [];
      for (let step = 0; step < 12; step++) {
        const value = getRandom(11) - 5;
        const start = getRandom(11) - 5;
        const operations = [
          `values.push(${value})`,
          `alias.unshift(${value})`,
          "values.pop()",
          "alias.shift()",
          "values.reverse()",
          "alias.sort((first, second) => first - second)",
          `values.splice(${start}, ${getRandom(4)}, ${value})`,
          `alias.slice(${start})`,
          `values.concat([${value}])`,
          `values.fill(${value})`,
          "alias.toReversed()",
          `values.at(${start})`,
        ];
        expressions.push(`trace.push(String(${operations[getRandom(operations.length)]}));`);
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const values = [${values.join(",")}]; const alias = values; const trace = []; ${expressions.join("\n")} return trace.join('|') + '#' + values.join(',') + '#' + alias.length + '#' + (values === alias);`,
      });
    }
    await checkDifferentialCases(cases);
  },
);
