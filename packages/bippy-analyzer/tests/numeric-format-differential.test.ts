import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface NumericFormat {
  name: string;
  arguments: string[];
}

const values = [
  "0",
  "-0",
  "0.1",
  "-0.1",
  "1.005",
  "2.55",
  "9.999",
  "-12.5",
  "1e-7",
  "1e-6",
  "1e20",
  "1e21",
  "9007199254740991",
  "5e-324",
  "1.7976931348623157e308",
  "NaN",
  "Infinity",
  "-Infinity",
];
const formats: NumericFormat[] = [
  {
    name: "toFixed",
    arguments: [
      "",
      "undefined",
      "null",
      "false",
      "true",
      "'2'",
      "-0.5",
      "0",
      "1",
      "2",
      "20",
      "99",
      "100",
    ],
  },
  { name: "toPrecision", arguments: ["", "1", "2", "20", "99", "100", "true", "'3'", "2.9"] },
  { name: "toString", arguments: ["", "2", "8", "10", "16", "36", "'16'", "16.9"] },
];

it.each(formats)("matches finite number formatting for $name", (format) =>
  checkDifferentialCases(
    values.flatMap((value) =>
      format.arguments.map((argument) => ({
        name: `${value}.${format.name}(${argument})`,
        body: `return (${value}).${format.name}(${argument});`,
      })),
    ),
  ),
);

it.each([
  {
    name: "toPrecision treats explicit undefined as an omitted precision",
    expected: "1.25",
    message: "toPrecision() argument must be between 1 and 100",
    body: `return (1.25).toPrecision(undefined);`,
  },
  {
    name: "toString treats explicit undefined as decimal radix",
    expected: "15",
    message: "toString() radix argument must be between 2 and 36",
    body: `return (15).toString(undefined);`,
  },
])("known divergence: evaluator crash: $name", async ({ name, body, expected, message }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  await expect(checkDifferentialCases([{ name, body }])).rejects.toMatchObject({
    name: "AnalyzerEvaluationCrash",
    cause: { name: "RangeError", message },
  });
});

it.each([
  {
    name: "toExponential supports omitted precision",
    expected: "1.25e+1",
    actual: "<string: toExponential()>",
    body: `return (12.5).toExponential();`,
  },
  {
    name: "toExponential rounds with explicit precision",
    expected: "1.250e+1",
    actual: "<string: toExponential()>",
    body: `return (12.5).toExponential(3);`,
  },
  {
    name: "formatting digit conversion rejects BigInt",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { (1.25).toFixed(1n); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "formatting digit conversion rejects Symbol",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { (1.25).toFixed(Symbol('digits')); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "formatting digit objects are converted once before formatting",
    expected: "digits:1.25",
    actual: "<string: + on dynamic values>",
    body: `const trace = []; const digits = { valueOf() { trace.push('digits'); return 2; } }; const result = (1.25).toFixed(digits); return trace.join('|') + ':' + result;`,
  },
  {
    name: "throwing digit conversion prevents later statements",
    expected: "digits|caught:digits",
    actual: '"after"',
    body: `const trace = []; const digits = { valueOf() { trace.push('digits'); throw 'digits'; } }; try { (1.25).toFixed(digits); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
