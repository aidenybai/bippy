import { it } from "vite-plus/test";
import type { StaticPrimitive } from "../src/types.js";
import { checkSsaAgainstNative } from "./helpers/ssa-evaluator.js";

interface ScalarCase {
  source: string;
  value: StaticPrimitive;
}

const scalars: ScalarCase[] = [
  { source: "(void 0)", value: undefined },
  { source: "null", value: null },
  { source: "false", value: false },
  { source: "true", value: true },
  { source: "0", value: 0 },
  { source: "(-0)", value: -0 },
  { source: "1", value: 1 },
  { source: "(-1)", value: -1 },
  { source: "3.5", value: 3.5 },
  { source: "(0 / 0)", value: NaN },
  { source: "(1 / 0)", value: Infinity },
  { source: '""', value: "" },
  { source: '"2"', value: "2" },
  { source: '"x"', value: "x" },
];
const binaryOperators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  "<=",
  ">",
  ">=",
  "===",
  "!==",
  "==",
  "!=",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
];
const binaryCases = binaryOperators.flatMap((operator) =>
  scalars.flatMap((left) =>
    scalars.map((right) => ({
      operator,
      left,
      right,
      name: `${left.source} ${operator} ${right.source}`,
    })),
  ),
);

it.each(binaryCases)(
  "matches native binary operands and constant folding: $name",
  ({ operator, left, right }) => {
    checkSsaAgainstNative(`return first ${operator} second;`, {
      first: left.value,
      second: right.value,
    });
    checkSsaAgainstNative(`return ${left.source} ${operator} ${right.source};`);
  },
);

it.each(
  ["!", "+", "-", "~", "typeof", "void"].flatMap((operator) =>
    scalars.map((operand) => ({ operator, operand, name: `${operator} ${operand.source}` })),
  ),
)("matches native unary operands and constant folding: $name", ({ operator, operand }) => {
  checkSsaAgainstNative(`return ${operator} first;`, { first: operand.value });
  checkSsaAgainstNative(`return ${operator} ${operand.source};`);
});

it.each(
  ["&&", "||", "??"].flatMap((operator) =>
    scalars.flatMap((left) =>
      scalars.map((right) => ({
        operator,
        left,
        right,
        name: `${left.source} ${operator} ${right.source}`,
      })),
    ),
  ),
)("preserves logical values and RHS effects: $name", ({ operator, left, right }) => {
  const bindings = { first: left.value, second: right.value };
  checkSsaAgainstNative(`return first ${operator} second;`, bindings);
  checkSsaAgainstNative(
    `let reads = 0; first ${operator} (reads++, second); return reads;`,
    bindings,
  );
  checkSsaAgainstNative(`let value = first; value ${operator}= second; return value;`, bindings);
});

it.each(
  [
    ...scalars,
    { source: "0n", value: 0n },
    { source: "1n", value: 1n },
    { source: "(-1n)", value: -1n },
  ].flatMap((operand) =>
    ["++", "--"].flatMap((operator) =>
      [false, true].map((prefix) => ({
        operand,
        operator,
        prefix,
        name: `${prefix ? "prefix" : "postfix"} ${operator} ${operand.source}`,
      })),
    ),
  ),
)("preserves update values and writes: $name", ({ operand, operator, prefix }) => {
  const update = prefix ? `${operator} value` : `value ${operator}`;
  checkSsaAgainstNative(`let value = first; return ${update};`, { first: operand.value });
  checkSsaAgainstNative(`let value = first; ${update}; return value;`, { first: operand.value });
  checkSsaAgainstNative(`let value = ${operand.source}; return ${update};`);
});

it.each(
  binaryOperators.flatMap((operator) =>
    ["0", "(-0)", "3", "(0/0)"].map((source) => ({ operator, source })),
  ),
)("agrees with folding disabled: $source $operator 2", ({ operator, source }) => {
  checkSsaAgainstNative(`const value = ${source}; return value ${operator} 2;`, {}, true);
});
