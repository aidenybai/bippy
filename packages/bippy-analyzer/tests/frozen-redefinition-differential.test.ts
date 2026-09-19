import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface FrozenOperand {
  source: string;
  value: unknown;
}

const operands: FrozenOperand[] = [
  { source: "-0", value: -0 },
  { source: "0", value: 0 },
  { source: "NaN", value: NaN },
  { source: "7", value: 7 },
  { source: "7n", value: 7n },
  { source: "'7'", value: "7" },
  { source: "true", value: true },
  { source: "null", value: null },
  { source: "undefined", value: undefined },
  { source: "firstObject", value: {} },
  { source: "secondObject", value: {} },
  { source: "firstSymbol", value: Symbol("value") },
  { source: "secondSymbol", value: Symbol("value") },
];

const cases = [false, true].flatMap((isArray) =>
  operands.flatMap((initial) =>
    operands.map((replacement) => ({
      name: `${isArray ? "array" : "object"}/${initial.source}/${replacement.source}`,
      isArray,
      initial: initial.source,
      isSame: Object.is(initial.value, replacement.value),
      body: `const firstObject = {}; const secondObject = {}; const firstSymbol = Symbol('value'); const secondSymbol = Symbol('value'); const before = ${initial.source}; const after = ${replacement.source}; const target = Object.freeze(${isArray ? "[before]" : "{ value: before }"}); const key = ${isArray ? "'0'" : "'value'"}; let outcome = 'accepted'; try { Object.defineProperty(target, key, { value: after, enumerable: true, writable: false, configurable: false }); } catch (error) { outcome = error.name; } return outcome + ':' + Object.is(target[key], before) + ':' + Object.is(target[key], after);`,
    })),
  ),
);

it.each(cases.filter((testCase) => testCase.isSame))(
  "preserves SameValue frozen redefinition $name",
  ({ name, body }) => checkDifferentialCases([{ name, body }]),
);

it.each(
  [false, true].flatMap((isArray) =>
    operands.map((initial) => ({
      isArray,
      initial: initial.source,
      name: `${isArray ? "array" : "object"}/${initial.source}`,
    })),
  ),
)("known divergence: frozen replacement matrix $name", ({ isArray, initial }) =>
  checkKnownDifferentialWitnesses(
    cases
      .filter(
        (testCase) =>
          testCase.isArray === isArray && testCase.initial === initial && !testCase.isSame,
      )
      .map(({ name, body }) => ({
        name,
        body,
        expected: "TypeError:true:false",
        actual: JSON.stringify(isArray ? "accepted:true:false" : "accepted:false:true"),
      })),
  ),
);
