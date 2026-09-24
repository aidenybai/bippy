import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches ordinary Object wrapper conversions and own data, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(31) - 15;
      const increment = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const number = Object(${initial}); const other = Object(${increment});
      const text = Object('${initial}'); const boolean = Object(${index % 2 === 0});
      number.extra = ${increment};
      return (number + other) + ':' + Number(number) + ':' + String(text) + ':' + Boolean(boolean) + ':' + number.extra + ':' + (Object(number) === number);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

interface BoxedPrimitive {
  name: string;
  source: string;
}

const values: BoxedPrimitive[] = [
  { name: "zero", source: "0" },
  { name: "negative-zero", source: "-0" },
  { name: "nan", source: "NaN" },
  { name: "fraction", source: "5.5" },
  { name: "infinity", source: "Infinity" },
  { name: "empty-string", source: "''" },
  { name: "text", source: "'abc'" },
  { name: "surrogate-pair", source: "'😀'" },
  { name: "true", source: "true" },
  { name: "false", source: "false" },
  { name: "bigint-zero", source: "0n" },
  { name: "large-bigint", source: "9007199254740993n" },
];

it.each(values)("preserves Object boxing and primitive extraction for $name", ({ name, source }) =>
  checkDifferentialCases([
    {
      name,
      body: `const primitive = ${source}; const boxed = Object(primitive); return typeof boxed + ':' + Object.is(boxed.valueOf(), primitive) + ':' + (Object(boxed) === boxed);`,
    },
  ]),
);

it.each([
  {
    name: "Object boxes a Symbol without changing its identity on extraction",
    expected: "object:true",
    actual: 'branch("object:true" | "object:false")',
    body: `const symbol = Symbol('boxed'); const boxed = Object(symbol); return typeof boxed + ':' + (boxed.valueOf() === symbol);`,
  },
  {
    name: "string wrapper indices are not writable in strict mode",
    expected: "TypeError",
    actual: '"accepted:a"',
    body: `const boxed = Object('abc'); try { boxed[0] = 'z'; return 'accepted:' + boxed[0]; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "boxed numbers preserve signed zero through Number conversion",
    body: `return Object.is(Number(Object(-0)), -0);`,
  },
  {
    name: "boxed strings expose UTF-16 indexed code units",
    body: `const boxed = Object('😀'); return boxed.length + ':' + boxed[0].charCodeAt(0) + ':' + boxed[1].charCodeAt(0);`,
  },
  {
    name: "ordinary Object boxing produces separate wrappers",
    body: `return Object(7) === Object(7);`,
  },
  {
    name: "Number construction creates an object wrapper",
    body: `return typeof new Number(7);`,
  },
  {
    name: "Boolean construction creates an object wrapper",
    body: `return typeof new Boolean(false);`,
  },
  {
    name: "String construction creates an object wrapper",
    body: `return typeof new String('abc');`,
  },
  {
    name: "a constructed false Boolean wrapper is truthy",
    body: `return Boolean(new Boolean(false));`,
  },
  {
    name: "distinct constructed Number wrappers have different identities",
    body: `return new Number(7) === new Number(7);`,
  },
  {
    name: "constructed wrappers accept independent own properties",
    body: `const boxed = new Number(7); try { boxed.extra = 9; return boxed.extra + ':' + boxed.valueOf(); } catch (error) { return error.name; }`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
