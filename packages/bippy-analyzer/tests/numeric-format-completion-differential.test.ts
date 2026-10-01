import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface NumericMethod {
  name: string;
  message: string;
}

interface NumericArgument {
  name: string;
  source: string;
  error: string | null;
}

const methods: NumericMethod[] = [
  { name: "toFixed", message: "toFixed() digits argument must be between 0 and 100" },
  { name: "toPrecision", message: "toPrecision() argument must be between 1 and 100" },
  { name: "toString", message: "toString() radix argument must be between 2 and 36" },
];
const argumentsToCheck: NumericArgument[] = [
  { name: "negative-infinity", source: "-Infinity", error: null },
  { name: "negative-one", source: "-1", error: null },
  { name: "zero", source: "0", error: null },
  { name: "one-hundred-one", source: "101", error: null },
  { name: "infinity", source: "Infinity", error: null },
  { name: "bigint", source: "2n", error: "TypeError" },
  { name: "symbol", source: "Symbol('digits')", error: "TypeError" },
  {
    name: "throwing-object",
    source: `({ valueOf() { trace.push('digits'); throw 'digits'; } })`,
    error: "digits",
  },
];
const cases = methods.flatMap((method) =>
  ["1", "NaN", "Infinity", "-Infinity"].flatMap((receiver) =>
    argumentsToCheck.map((argument) => {
      const name = `${receiver}.${method.name}/${argument.name}`;
      const isCrash =
        argument.error === null &&
        !(method.name === "toFixed" && argument.name === "zero") &&
        !(method.name === "toPrecision" && receiver !== "1");
      const expected = isCrash
        ? "error:RangeError"
        : argument.error === "digits"
          ? "digits|error:digits"
          : argument.error
            ? `error:${argument.error}`
            : "after";
      return {
        name,
        label: `${isCrash ? "known divergence: evaluator crash: " : argument.error ? "known divergence: " : ""}${name}`,
        isCrash,
        isKnown: argument.error !== null,
        expected,
        message: method.message,
        body: `const trace = []; try { (${receiver}).${method.name}(${argument.source}); trace.push('after'); } catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); } return trace.join('|');`,
      };
    }),
  ),
);

it.each(cases)("$label", async ({ name, body, isCrash, isKnown, expected, message }) => {
  if (isCrash) {
    expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
      expected,
    );
    await expect(checkDifferentialCases([{ name, body }])).rejects.toMatchObject({
      name: "AnalyzerEvaluationCrash",
      cause: { name: "RangeError", message },
    });
  } else if (isKnown) {
    await checkKnownDifferentialWitnesses([{ name, body, expected, actual: '"after"' }]);
  } else {
    await checkDifferentialCases([{ name, body }]);
  }
});

it.each(methods)("known divergence: native-wrapper $name range errors disappear", (method) =>
  checkKnownDifferentialWitnesses([
    {
      name: `boxed/${method.name}/negative digits`,
      expected: "RangeError",
      actual: '"accepted"',
      body: `try { Object(1).${method.name}(-1); return 'accepted'; } catch (error) { return error.name; }`,
    },
  ]),
);

it.each(methods)("preserves valid native-wrapper $name formatting", (method) =>
  checkDifferentialCases([
    {
      name: `boxed/${method.name}/valid digits`,
      body: `return Object(1.25).${method.name}(2);`,
    },
  ]),
);
