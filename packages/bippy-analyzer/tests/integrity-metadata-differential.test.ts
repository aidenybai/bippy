import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkExpectedDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface IntegrityShape {
  name: string;
  source: string;
}

const shapes: IntegrityShape[] = [
  { name: "empty-object", source: "{}" },
  { name: "data-object", source: "{ value: 7 }" },
  { name: "accessor-object", source: "{ get value() { return 7; } }" },
  { name: "data-array", source: "[7]" },
  { name: "boxed-number", source: "Object(7)" },
];

const cases = shapes.flatMap((shape) =>
  ["none", "freeze", "seal", "preventExtensions"].flatMap((operation) =>
    ["isExtensible", "isSealed", "isFrozen"].map((query) => {
      const name = `${shape.name}/${operation}/${query}`;
      const isEmpty = shape.name === "empty-object" || shape.name === "boxed-number";
      const isSealed = operation !== "none" && (isEmpty || operation !== "preventExtensions");
      const isFrozen =
        operation !== "none" &&
        (isEmpty ||
          operation === "freeze" ||
          (operation === "seal" && shape.name === "accessor-object"));
      const expected =
        query === "isExtensible"
          ? operation === "none"
          : query === "isSealed"
            ? isSealed
            : isFrozen;
      const isKnown =
        (shape.name === "data-array" && query !== "isFrozen") || shape.name === "boxed-number";
      return {
        name,
        label: `${isKnown ? "known precision gap: " : ""}${name}`,
        isKnown,
        expected,
        actual: `<boolean: Object.${query} on a dynamic target>`,
        body: `const target = ${shape.source}; ${operation === "none" ? "" : `Object.${operation}(target);`} return Object.${query}(target);`,
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkExpectedDifferentialCases([{ name, body, expected }]),
);

it("preserves writable length on a sealed empty array", () =>
  checkDifferentialCases([
    {
      name: "a sealed empty array still has writable length",
      body: `const target = []; Object.seal(target); target.length = 1; return target.length;`,
    },
  ]));
