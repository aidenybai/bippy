import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "copies only enumerable own data properties without mutating sources, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const keys = ["", "value", "constructor", "toString", "hasOwnProperty", "tail"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const definitions: string[] = [];
      for (const key of keys) {
        definitions.push(
          `Object.defineProperty(source, ${JSON.stringify(key)}, { value: ${getRandom(10)}, enumerable: ${getRandom(2) === 0}, configurable: true, writable: true });`,
        );
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const source = Object.create({ inherited: 8 });
        ${definitions.join("\n")}
        const spread = { ...source };
        const assigned = Object.assign({}, source);
        const describe = (object) => Object.keys(object).map((key) => key + ':' + object[key]).join('|');
        const before = describe(source);
        spread.value = 99; assigned.tail = 88;
        return before + '#' + describe(source) + '#' + describe(spread) + '#' + describe(assigned) + '#' + ('inherited' in spread);
      `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const copyMutations: Record<string, string> = {
  none: "",
  delete: "delete source.second;",
  overwrite: "source.second = 99;",
  append: "source.third = 3;",
  throw: "throw 'getter';",
};

describe.each(["assign", "spread"])("%s accessor copying", (method) => {
  it.each(Object.keys(copyMutations))("observes %s while copying a getter", (mutation) =>
    checkDifferentialCases([
      {
        name: `${method}/${mutation}`,
        body: `
      let trace = '';
      const source = { get first() { trace += 'G'; ${copyMutations[mutation]} return 1; }, second: 2 };
      const target = { set first(value) { trace += 'S' + value; } };
      let result;
      try { result = ${method === "assign" ? "Object.assign(target, source)" : "{ ...target, ...source }"}; }
      catch (error) { result = {}; trace += 'C' + error; }
      return trace + '|' + Object.keys(result).join(',') + '|' + result.second + '|' + source.second;
    `,
      },
    ]),
  );
});

it.each([
  {
    name: "numeric own-key ordering",
    body: "const target = {}; target.z = 0; target['10'] = 1; target['2'] = 2; target['01'] = 3; return Object.keys(target).join(',');",
  },
  {
    name: "non-writable data property",
    body: "const target = {}; Object.defineProperty(target, 'value', { value: 1 }); try { target.value = 2; return 'wrote:' + target.value; } catch (error) { return error.name + ':' + target.value; }",
  },
  {
    name: "non-configurable deletion",
    body: "const target = {}; Object.defineProperty(target, 'value', { value: 1 }); try { delete target.value; return 'deleted'; } catch (error) { return error.name + ':' + target.value; }",
  },
  {
    name: "mixed accessor and data descriptor",
    body: "try { Object.defineProperty({}, 'value', { value: 1, get: () => 2 }); return 'accepted'; } catch (error) { return error.name; }",
  },
])("respects $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "assign invokes inherited prototype setter, spread creates own data",
    body: "const source = Object.create(null); source.__proto__ = { inherited: 7 }; const assigned = Object.assign({}, source); const spread = { ...source }; return Object.hasOwn(assigned, '__proto__') + ':' + assigned.inherited + ':' + Object.hasOwn(spread, '__proto__') + ':' + spread.inherited;",
  },
])("known divergence: respects $name", (testCase) => checkKnownDifferentialCases([testCase]));

it.each([
  { name: "number conversion", expression: "Number(value)" },
  { name: "string conversion", expression: "String(value)" },
  { name: "default hint for addition", expression: "value + 1" },
  { name: "number hint for comparison", expression: "value < 10" },
  { name: "string hint for a property key", expression: "({ 7: 'found' })[value]" },
])("known divergence: Symbol.toPrimitive effects: $name", ({ name, expression }) =>
  checkKnownDifferentialCases([
    {
      name,
      body: `let trace = ''; const value = { [Symbol.toPrimitive]: (hint) => { trace += hint; return 7; } }; const result = ${expression}; return String(result) + ':' + trace;`,
    },
  ]),
);

it.each(["value === 7", "Boolean(value)"])("does not coerce objects for %s", (expression) =>
  checkDifferentialCases([
    {
      name: expression,
      body: `const value = { [Symbol.toPrimitive]: () => { throw 'unexpected conversion'; } }; return ${expression};`,
    },
  ]),
);
