import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const values = [
  "0n",
  "1n",
  "2n",
  "37n",
  "9007199254740993n",
  "18446744073709551615n",
  "340282366920938463463374607431768211455n",
];

it("matches seven BigInt magnitudes across all 35 valid integer radices", () =>
  checkDifferentialCases(
    values.flatMap((value) =>
      Array.from({ length: 35 }, (_value, index) => ({
        name: `${value}/radix=${index + 2}`,
        body: `return (${value}).toString(${index + 2});`,
      })),
    ),
  ));

it("matches omitted BigInt radices", () =>
  checkDifferentialCases(
    values.map((value) => ({
      name: `${value}/default radix`,
      body: `return (${value}).toString();`,
    })),
  ));

it.each([
  {
    name: "explicit undefined BigInt radix",
    expected: "3",
    body: `return (3n).toString(undefined);`,
  },
  {
    name: "caught invalid BigInt radix",
    expected: "RangeError",
    body: `try { (3n).toString(1); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: evaluator crash: $name", async ({ name, body, expected }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  await expect(checkDifferentialCases([{ name, body }])).rejects.toMatchObject({
    name: "AnalyzerEvaluationCrash",
    cause: { name: "RangeError", message: "toString() radix argument must be between 2 and 36" },
  });
});

it.each([
  {
    name: "BigInt-valued radix is rejected",
    expected: "TypeError",
    body: `try { (3n).toString(2n); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "Symbol-valued radix is rejected",
    expected: "TypeError",
    body: `try { (3n).toString(Symbol('radix')); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "boxed BigInt invalid radix is caught",
    expected: "RangeError",
    body: `try { Object(3n).toString(1); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) =>
  checkKnownDifferentialWitnesses([{ ...testCase, actual: '"accepted"' }]),
);

it("preserves valid boxed BigInt formatting", () =>
  checkDifferentialCases([
    {
      name: "boxed BigInt hexadecimal",
      body: `return Object(9007199254740993n).toString(16);`,
    },
  ]));
