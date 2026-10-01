import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

interface PrimitiveOperand {
  name: string;
  source: string;
}

const operands: PrimitiveOperand[] = [
  { name: "undefined", source: "undefined" },
  { name: "null", source: "null" },
  { name: "false", source: "false" },
  { name: "true", source: "true" },
  { name: "zero", source: "0" },
  { name: "negative-zero", source: "-0" },
  { name: "one", source: "1" },
  { name: "negative-one", source: "-1" },
  { name: "two", source: "2" },
  { name: "half", source: "0.5" },
  { name: "negative-half", source: "-0.5" },
  { name: "shift-limit", source: "31" },
  { name: "shift-wrap", source: "32" },
  { name: "int32-max", source: "2147483647" },
  { name: "int32-sign-bit", source: "2147483648" },
  { name: "uint32-max", source: "4294967295" },
  { name: "uint32-wrap", source: "4294967296" },
  { name: "max-safe-integer", source: "9007199254740991" },
  { name: "min-subnormal", source: "5e-324" },
  { name: "max-finite", source: "1.7976931348623157e308" },
  { name: "nan", source: "NaN" },
  { name: "infinity", source: "Infinity" },
  { name: "negative-infinity", source: "-Infinity" },
  { name: "empty-string", source: "''" },
  { name: "zero-string", source: "'0'" },
  { name: "one-string", source: "'1'" },
  { name: "nonnumeric-string", source: "'text'" },
];

it.each([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  ">",
  "<=",
  ">=",
  "==",
  "!=",
  "===",
  "!==",
  "|",
  "&",
  "^",
  "<<",
  ">>",
  ">>>",
])("matches the complete selected primitive operand product for %s", (operator) =>
  checkDifferentialCases(
    operands.flatMap((left) =>
      operands.map((right) => ({
        name: `${left.name} ${operator} ${right.name}`,
        body: `return (${left.source}) ${operator} (${right.source});`,
      })),
    ),
  ),
);
