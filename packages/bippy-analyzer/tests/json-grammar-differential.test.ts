import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

const whitespace = ["", " ", "\t", "\n", "\r\n"];
const validValues = [
  "null",
  "true",
  "false",
  "0",
  "-0",
  "1.25",
  "1e3",
  "-2E-2",
  "1e400",
  '"\\uD83D\\uDE00"',
  '"\\uD800"',
  '"\\b\\f\\n\\r\\t\\\\\\\""',
  "[]",
  "{}",
  "[1,null,false]",
  '{"value":1,"value":2}',
];

it.each(validValues)("matches JSON grammar and whitespace boundaries for %s", (value) =>
  checkDifferentialCases(
    whitespace.flatMap((leading) =>
      whitespace.map((trailing) => ({
        name: `${JSON.stringify(leading)}/${value}/${JSON.stringify(trailing)}`,
        body: `const result = JSON.parse(${JSON.stringify(leading + value + trailing)}); return typeof result + ':' + Object.is(result, -0) + ':' + String(JSON.stringify(result));`,
      })),
    ),
  ),
);

const invalidValues = [
  "undefined",
  "NaN",
  "Infinity",
  "+1",
  "01",
  "-01",
  "1.",
  ".1",
  "1e",
  "1e+",
  "[1,]",
  "[,1]",
  '{"value":}',
  "{value:1}",
  '{"value":1,}',
  '"\\x41"',
  '"\\uZZZZ"',
  '"line\nnext"',
  "true false",
  "/*note*/1",
  "1//note",
  "\ufeff1",
  "\u00a01",
  "{",
  "[",
  '"',
];

it.each(invalidValues)(
  "rejects malformed JSON independently of surrounding whitespace: %s",
  (value) =>
    checkDifferentialCases(
      whitespace.map((padding) => ({
        name: `${JSON.stringify(padding)}/${JSON.stringify(value)}`,
        body: `try { JSON.parse(${JSON.stringify(padding + value + padding)}); return 'accepted'; } catch (error) { return error.name; }`,
      })),
    ),
);
