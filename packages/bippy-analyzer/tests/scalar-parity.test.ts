import { createHash } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { checkScalarExpression } from "./helpers/scalar-oracle.js";
import {
  binaryOperators,
  scalarLiterals,
  generatedInputs,
  generatedSeeds,
  getScalarPrograms,
} from "./helpers/scalar-programs.js";

const matrix = binaryOperators.flatMap((operator) =>
  scalarLiterals.map((left) => ({ operator, left })),
);
const programs = generatedSeeds.flatMap(getScalarPrograms);

it.each(matrix)(
  "matches every selected literal pair for $operator with $left",
  async ({ operator, left }) => {
    for (const right of scalarLiterals) {
      await checkScalarExpression(
        `(enabled ? ${left} : ${right}) ${operator} (other ? ${right} : ${left})`,
      );
    }
  },
);

it.each(programs)(
  "preserves values, exceptions, guards, and node order: seed=$seed case=$index",
  async ({ source }) => {
    await checkScalarExpression(source, generatedInputs);
  },
);

it("pins the generated selection without filtering rejected or failing programs", () => {
  expect(programs).toHaveLength(192);
  expect(programs.every((program) => program.source.length <= 4096)).toBe(true);
  expect(createHash("sha256").update(JSON.stringify(programs)).digest("hex")).toBe(
    "a29237ea49425e28851872523d257191b4e3d824118e712b3c76d8ccade01f7c",
  );
});

it.each([
  "(enabled ? 4294967295 : -2147483649) >>> (other ? 0 : 32)",
  "(enabled ? 4294967296 : 2147483648) >> (other ? 31 : -1)",
  "(enabled ? -1 : 1) << (other ? 32 : 33)",
  "(enabled ? 9007199254740991 : -9007199254740991) | (other ? -0 : NaN)",
  "(enabled ? -2147483648 : 2147483647) & (other ? 4294967295 : 1)",
  "(enabled ? -2147483649 : 2147483648) ^ (other ? Infinity : -Infinity)",
  "(enabled ? 1n : -1n) << (other ? 64n : -1n)",
  "(enabled ? -1n : 2n) >> (other ? 64n : -1n)",
  "(enabled ? 0n : 1n) >>> (other ? 0n : 1n)",
  "(enabled ? 1n : -1n) & (other ? 0n : -1n)",
  "(enabled ? 1n : -1n) | (other ? 0n : 2n)",
  "(enabled ? 1n : -1n) ^ (other ? 0n : 2n)",
  "(enabled << 1) ? (enabled ? 7 : 1n / 0n) : (enabled ? 1n / 0n : 8)",
  "(+enabled << 31) >> 31",
  "(enabled ? 1n / 0n : 1) >>> (other ? 1 : 2)",
  "(enabled ? 1n : 1) << (other ? 1n / 0n : 1)",
])("preserves integer boundaries and shift errors: %s", (source) => checkScalarExpression(source));
