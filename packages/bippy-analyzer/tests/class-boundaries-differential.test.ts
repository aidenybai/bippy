import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

describe.each([0, 1, 2, 6, 7, 8, 9, 12])("inheritance depth %i", (depth) => {
  it(
    depth < 8
      ? "matches native initialization through every ancestor"
      : "known divergence: truncation does not erase ancestor effects and properties",
    () => {
      const declarations = Array.from(
        { length: depth },
        (_, index) =>
          `class Layer${index + 1} extends Layer${index} { field${index + 1} = (trace.push('field-${index + 1}'), ${index + 1}); }`,
      );
      const fields = Array.from({ length: depth }, (_, index) => `field-${index + 1}`);
      const testCase = {
        name: `depth=${depth}`,
        body: `const trace = []; class Layer0 { root = (trace.push('root-field'), 1); constructor() { trace.push('root-body'); } } ${declarations.join("\n")} const instance = new Layer${depth}(); return trace.join('|') + '#' + instance.root;`,
      };
      if (depth < 8) return checkDifferentialCases([testCase]);
      return checkKnownDifferentialWitnesses([
        {
          ...testCase,
          expected: ["root-field", "root-body", ...fields].join("|") + "#1",
          actual: JSON.stringify(fields.slice(-8).join("|") + "#undefined"),
        },
      ]);
    },
  );
});

describe.each([
  { name: "plain object", expression: "({})", isKnown: false },
  { name: "array", expression: "[]", isKnown: true },
  { name: "function", expression: "(() => 1)", isKnown: true },
  { name: "proxy", expression: "new Proxy({}, {})", isKnown: true },
])("constructor replacement: $name", ({ name, expression, isKnown }) => {
  it(
    isKnown
      ? "known divergence: derived field effects execute on non-plain replacements"
      : "matches native derived field effects on a replacement",
    () => {
      const testCase = {
        name,
        body: `const trace = []; const replacement = ${expression}; class Base { constructor() { return replacement; } } class Child extends Base { value = (trace.push('field'), 7); } new Child(); trace.push('after'); return trace.join('|');`,
      };
      if (!isKnown) return checkDifferentialCases([testCase]);
      return checkKnownDifferentialWitnesses([
        { ...testCase, expected: "field|after", actual: JSON.stringify("after") },
      ]);
    },
  );
});
