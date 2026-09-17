import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches strict arguments, parameters, rest arrays and caller copies, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const values = Array.from({ length: 3 + getRandom(4) }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const input = [${values.join(",")}];
      const owner = { read(first, second, ...rest) {
        const previous = [...arguments];
        first += ${getRandom(20)};
        arguments[1] = ${20 + getRandom(20)};
        rest[0] = ${40 + getRandom(20)};
        const inherited = () => arguments[0];
        return first + ':' + second + ':' + rest.join(',') + ':' + arguments[0] + ':' + arguments[1] + ':' + arguments[2] + ':' + arguments.length + ':' + previous.join(',') + ':' + inherited();
      } };
      const result = ${index % 2 === 0 ? "owner.read(...input)" : "owner.read.call(null, ...input)"};
      return result + '#' + input.join(',');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "arguments is not an Array",
    expected: false,
    actual: "true",
    body: `return ({ read() { return Array.isArray(arguments); } }).read(1);`,
  },
  {
    name: "arguments indexed writes do not grow length",
    expected: "1:7",
    actual: JSON.stringify("4:7"),
    body: `return ({ read() { arguments[3] = 7; return arguments.length + ':' + arguments[3]; } }).read(1);`,
  },
  {
    name: "arguments length writes do not truncate indexed properties",
    expected: "0:7",
    actual: JSON.stringify("0:undefined"),
    body: `return ({ read() { arguments.length = 0; return arguments.length + ':' + arguments[0]; } }).read(7);`,
  },
  {
    name: "strict arguments callee access throws",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `return ({ read() { try { arguments.callee; return 'accepted'; } catch (error) { return error.name; } } }).read();`,
  },
  {
    name: "apply does not share its input array with arguments",
    expected: "1,2:9",
    actual: JSON.stringify("9,2:9"),
    body: `const input = [1, 2]; const owner = { read() { arguments[0] = 9; return arguments[0]; } }; const result = owner.read.apply(null, input); return input.join(',') + ':' + result;`,
  },
  {
    name: "parameter defaults see the callee arguments rather than the caller arguments",
    expected: undefined,
    actual: "7",
    body: `const owner = { outer() { return ({ inner(value = arguments[0]) { return value; } }).inner(); } }; return owner.outer(7);`,
  },
  {
    name: "parameter defaults see their own arguments length",
    expected: 0,
    actual: 'unknown(unbound identifier "arguments")',
    body: `return ({ read(value = arguments.length) { return value; } }).read();`,
  },
  {
    name: "Array.from copies arguments independently",
    expected: 1,
    actual: "9",
    body: `return ({ read() { const copy = Array.from(arguments); arguments[0] = 9; return copy[0]; } }).read(1);`,
  },
  {
    name: "Array.from creates a distinct array",
    expected: false,
    actual: "true",
    body: `const source = [1]; return Array.from(source) === source;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("mapped Array.from creates an independent copy", () =>
  checkDifferentialCases([
    {
      name: "mapped Array.from copy",
      body: `const source = [1]; const copy = Array.from(source, (value) => value); copy[0] = 9; return source[0];`,
    },
  ]));

it.each([
  { name: "zero parameters", expression: "() => 0" },
  { name: "one parameter", expression: "(first) => 0" },
  { name: "middle default", expression: "(first, second = 0, third) => 0" },
  { name: "rest parameter", expression: "(first, ...rest) => 0" },
  { name: "destructured parameters", expression: "({ value }, [entry]) => 0" },
  { name: "initial default", expression: "(first = 0, second) => 0" },
  { name: "only rest", expression: "(...values) => 0" },
])("matches bound name and length matrix: $name", async ({ name, expression }) => {
  const cases: DifferentialCase[] = [];
  for (let leading = 0; leading < 5; leading++) {
    for (let trailing = 0; trailing < 3; trailing++) {
      cases.push({
        name: `${name}/${leading}/${trailing}`,
        body: `const target = ${expression}; const bound = target.bind(null, ...[${Array.from({ length: leading }, () => 1).join(",")}]); const rebound = bound.bind(null, ...[${Array.from({ length: trailing }, () => 2).join(",")}]); return target.length + ':' + bound.length + ':' + rebound.length + ':' + target.name + ':' + bound.name + ':' + rebound.name + ':' + Object.hasOwn(rebound, 'prototype');`,
      });
    }
  }
  await checkDifferentialCases(cases);
});

it("known divergence: dynamic function name and length when binding", () =>
  checkKnownDifferentialWitnesses([
    {
      name: "dynamic bind metadata",
      expected: "length|name:2:bound custom",
      actual: JSON.stringify(":0:bound custom"),
      body: `const trace = []; const target = () => 1; Object.defineProperty(target, 'length', { get() { trace.push('length'); return 3; } }); Object.defineProperty(target, 'name', { get() { trace.push('name'); return 'custom'; } }); trace.length = 0; const bound = target.bind(null, 1); return trace.join('|') + ':' + bound.length + ':' + bound.name;`,
    },
  ]));
