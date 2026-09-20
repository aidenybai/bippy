import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const expectedResults: Record<string, string> = {
  "+": "bigint:5",
  "-": "bigint:1",
  "*": "bigint:6",
  "/": "bigint:1",
  "%": "bigint:1",
  "**": "bigint:9",
  "&": "bigint:2",
  "|": "bigint:3",
  "^": "bigint:1",
  "<<": "bigint:12",
  ">>": "bigint:0",
  ">>>": "error:TypeError",
  "<": "boolean:false",
  ">": "boolean:true",
  "<=": "boolean:false",
  ">=": "boolean:true",
};

it.each(
  Object.entries(expectedResults).map(([operator, expected]) => ({
    operator,
    expected,
    label: `${expected.startsWith("bigint:") ? "known divergence:" : "matches native:"} bounded BigInt ${operator} evaluation`,
  })),
)("$label", ({ operator, expected }) => {
  const testCase = {
    name: `3n ${operator} 2n`,
    body: `try { const result = 3n ${operator} 2n; return typeof result + ':' + String(result); } catch (error) { return 'error:' + error.name; }`,
  };
  return !expected.startsWith("bigint:")
    ? checkDifferentialCases([testCase])
    : checkKnownDifferentialWitnesses([
        { ...testCase, expected, actual: "<string: + on dynamic values>" },
      ]);
});

it.each([
  {
    name: "BigInt division by zero throws before following effects",
    body: `const trace = []; try { 1n / 0n; trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|');`,
  },
  {
    name: "negative BigInt exponent throws before following effects",
    body: `const trace = []; try { 2n ** (-1n); trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|');`,
  },
  {
    name: "mixed BigInt and number subtraction throws",
    body: `try { 2n - 1; return 'accepted'; } catch (error) { return error.name; }`,
  },
  { name: "negative BigInt literal comparison remains exact", body: `return (-1n) < 0n;` },
  { name: "BigInt and string addition concatenates", body: `return 2n + 'items';` },
  { name: "string and BigInt addition concatenates", body: `return 'items:' + 2n;` },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
