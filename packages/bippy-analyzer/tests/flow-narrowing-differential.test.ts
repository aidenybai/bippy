import { it } from "vite-plus/test";
import { unknownPrimitiveValue } from "../src/evaluate/values.js";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

const booleanComparisons = ["===", "!==", "==", "!="].flatMap((operator) =>
  [false, true].flatMap((literal) =>
    [false, true].map((isMirrored) => {
      const condition = isMirrored
        ? `${literal} ${operator} first`
        : `first ${operator} ${literal}`;
      return {
        name: `boolean comparison ${condition}`,
        body: `const label = (${condition}) ? "pass" : "fail";
          return label + ":" + String(first);`,
      };
    }),
  ),
);

const cases = [
  ...booleanComparisons,
  {
    name: "discriminant getters run once",
    body: `let reads = 0;
      const value = first
        ? { get kind() { reads++; return "leaf"; }, text: "a" }
        : { get kind() { reads++; return "node"; }, text: "b" };
      if (value.kind === "leaf") return reads + ":" + value.text;
      return reads + ":" + value.text;`,
  },
  {
    name: "typeof does not replay a discriminant getter",
    body: `let reads = 0;
      const value = first
        ? { get kind() { reads++; return "leaf"; }, text: "a" }
        : { get kind() { reads++; return 1; }, text: "b" };
      if (typeof value.kind === "string") return reads + ":" + value.text;
      return reads + ":" + value.text;`,
  },
  {
    name: "getter writes remain associated with the selected object",
    body: `const trace = [];
      const value = first
        ? { get kind() { trace.push("leaf"); return "leaf"; }, text: "a" }
        : { get kind() { trace.push("node"); return "node"; }, text: "b" };
      if (value.kind === "leaf") return trace.join(",") + ":" + value.text;
      return trace.join(",") + ":" + value.text;`,
  },
  {
    name: "predicate lookup does not replay a getter",
    body: `let reads = 0;
      const helpers = { get check() { reads++; return Array.isArray; } };
      const value = first ? [] : {};
      if (helpers.check(value)) return reads + ":array";
      return reads + ":object";`,
  },
  {
    name: "logical conjunction does not restore a value changed by a callback",
    body: `let value = first;
      let result = "no";
      if (value === true && (() => { value = false; return true; })()) result = "yes";
      return result + ":" + String(value);`,
  },
  {
    name: "logical disjunction does not refine a value changed by a callback",
    body: `let value = first;
      let result = "no";
      if (value === false || (() => { value = false; return false; })()) result = "yes";
      return result + ":" + String(value);`,
  },
  {
    name: "data discriminants retain their input guards",
    body: `const value = first ? { kind: "leaf", text: "a" } : { kind: "node", text: "b" };
      if (value.kind === "leaf") return value.text;
      return value.text;`,
  },
  {
    name: "literal equality composes with a second condition",
    body: `const value = first ? "leaf" : second ? "node" : null;
      if (value === "leaf" || value === "node") return String(value);
      return "missing";`,
  },
  {
    name: "captured bindings observe reassignment",
    body: `let value = first ? "leaf" : "node";
      const getValue = () => value;
      value = second ? "other" : "last";
      if (getValue() === "other") return getValue();
      return getValue();`,
  },
];

it.each(cases)("matches native flow narrowing: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase], false, {
    first: unknownPrimitiveValue("boolean", "first"),
    second: unknownPrimitiveValue("boolean", "second"),
  });
});
