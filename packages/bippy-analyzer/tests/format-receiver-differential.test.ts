import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface FormattingMethod {
  result: string;
  name: string;
  source: string;
  brand: string;
}

interface FormattingReceiver {
  name: string;
  source: string;
  brand: string;
}

const methods: FormattingMethod[] = [
  { name: "Number.toFixed", result: "7.00", source: "(7).toFixed", brand: "number" },
  { name: "Number.toPrecision", result: "7.0", source: "(7).toPrecision", brand: "number" },
  { name: "Number.toString", result: "111", source: "(7).toString", brand: "number" },
  { name: "BigInt.toString", result: "111", source: "(7n).toString", brand: "bigint" },
  { name: "Boolean.toString", result: "false", source: "(false).toString", brand: "boolean" },
  { name: "String.toString", result: "text", source: "('text').toString", brand: "string" },
];
const receivers: FormattingReceiver[] = [
  { name: "number", source: "7", brand: "number" },
  { name: "boxed-number", source: "Object(7)", brand: "number" },
  { name: "bigint", source: "7n", brand: "bigint" },
  { name: "boxed-bigint", source: "Object(7n)", brand: "bigint" },
  { name: "boolean", source: "false", brand: "boolean" },
  { name: "boxed-boolean", source: "Object(false)", brand: "boolean" },
  { name: "string", source: "'text'", brand: "string" },
  { name: "boxed-string", source: "Object('text')", brand: "string" },
  { name: "object", source: "{}", brand: "other" },
  { name: "array", source: "[]", brand: "other" },
  { name: "null", source: "null", brand: "other" },
  { name: "undefined", source: "undefined", brand: "other" },
  { name: "symbol", source: "Symbol('receiver')", brand: "other" },
];
const cases = methods.flatMap((method) =>
  receivers.map((receiver) => {
    const name = `${method.name}/${receiver.name}`;
    const isValid = method.brand === receiver.brand;
    const isKnown = !isValid || receiver.name.startsWith("boxed-");
    return {
      name,
      label: `${isKnown ? (isValid ? "known precision gap: " : "known divergence: ") : ""}${name}`,
      isKnown,
      expected: isValid ? method.result : "error:TypeError",
      actual: isValid ? `<string: ${method.name.split(".")[1]}()>` : '"accepted"',
      body: `const operation = ${method.source}; const receiver = ${receiver.source}; try { const result = operation.call(receiver, 2); return ${method.brand === receiver.brand ? "result" : "'accepted'"}; } catch (error) { return 'error:' + error.name; }`,
    };
  }),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);

it.each([
  {
    name: "Boolean toString ignores extra object arguments",
    expected: "false",
    actual: "unknown(false.toString())",
    body: `const ignored = { valueOf() { throw 'argument'; } }; return (false).toString(ignored);`,
  },
  {
    name: "Number valueOf ignores extra object arguments",
    expected: 7,
    actual: "<number: valueOf()>",
    body: `const ignored = { valueOf() { throw 'argument'; } }; return (7).valueOf(ignored);`,
  },
])("known precision gap: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("known divergence: evaluator crash: rebinding Boolean toString must not invoke Number formatting", async () => {
  const testCase = {
    name: "Boolean intrinsic identity",
    body: `const operation = (false).toString; try { operation.call(7, 1); return 'accepted'; } catch (error) { return error.name; }`,
  };
  expect(
    runInNewContext(`"use strict"; (() => { ${testCase.body} })()`, {}, { timeout: 1000 }),
  ).toBe("TypeError");
  await expect(checkDifferentialCases([testCase])).rejects.toMatchObject({
    name: "AnalyzerEvaluationCrash",
    cause: { name: "RangeError", message: "toString() radix argument must be between 2 and 36" },
  });
});

it.each(["(false).toString", "(7).valueOf"])(
  "preserves ignored argument expression effects for %s",
  (source) =>
    checkDifferentialCases([
      {
        name: `argument expression/${source}`,
        body: `const trace = []; const getArgument = () => { trace.push('argument'); return 2; }; const result = ${source}(getArgument()); return trace.join('|') + ':' + result;`,
      },
    ]),
);
