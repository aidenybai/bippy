import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const cases = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "<",
  ">",
  "<=",
  ">=",
].flatMap((operator) =>
  [false, true].map((isLeft) => ({
    name: `${operator}/symbolOnLeft=${isLeft}`,
    expected: "TypeError",
    actual: '"accepted"',
    body: `const value = Symbol('operand'); try { ${isLeft ? "value" : "2"} ${operator} ${isLeft ? "2" : "value"}; return 'accepted'; } catch (error) { return error.name; }`,
  })),
);

it.each(cases)("known divergence: Symbol conversion failure $name", (testCase) =>
  checkKnownDifferentialWitnesses([testCase]),
);

it("matches explicit String conversion of a Symbol", () => {
  const testCase = {
    name: "explicit String conversion accepts Symbol values",
    body: `return String(Symbol('operand'));`,
  };
  expect(runInNewContext(`(()=>{${testCase.body}})()`, {}, { timeout: 1000 })).toBe(
    "Symbol(operand)",
  );
  return checkDifferentialCases([testCase]);
});

it.each([
  { name: "Boolean conversion of a Symbol is truthy", body: `return Boolean(Symbol('operand'));` },
  { name: "typeof a Symbol does not coerce it", body: `return typeof Symbol('operand');` },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
