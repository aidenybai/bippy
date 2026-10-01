import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

interface EqualityOperand {
  name: string;
  source: string;
}

const operands: EqualityOperand[] = [
  { name: "bigint-zero", source: "0n" },
  { name: "bigint-one", source: "1n" },
  { name: "bigint-two", source: "2n" },
  { name: "bigint-three", source: "3n" },
  { name: "bigint-beyond-safe", source: "9007199254740993n" },
  { name: "number-zero", source: "0" },
  { name: "number-one", source: "1" },
  { name: "number-two", source: "2" },
  { name: "number-three", source: "3" },
  { name: "number-beyond-safe", source: "9007199254740992" },
  { name: "null", source: "null" },
  { name: "undefined", source: "undefined" },
  { name: "true", source: "true" },
  { name: "false", source: "false" },
  { name: "integer-string", source: "'1'" },
  { name: "decimal-string", source: "'1.0'" },
  { name: "beyond-safe-string", source: "'9007199254740993'" },
  { name: "nonnumeric-string", source: "'bad'" },
  { name: "shared-symbol", source: "shared" },
  { name: "fresh-symbol", source: "Symbol('selected')" },
  { name: "registered-symbol", source: "Symbol.for('selected')" },
  { name: "well-known-symbol", source: "Symbol.iterator" },
];

it.each(["==", "!=", "===", "!=="])(
  "matches the bounded BigInt/Symbol equality product for %s",
  (operator) =>
    checkDifferentialCases(
      operands.flatMap((left) =>
        operands.map((right) => ({
          name: `${left.name} ${operator} ${right.name}`,
          body: `${left.source === "shared" || right.source === "shared" ? "const shared = Symbol('selected');" : ""} return (${left.source}) ${operator} (${right.source});`,
        })),
      ),
    ),
);
