import { expect, it } from "vite-plus/test";
import { primitiveValue, unknownPrimitiveValue } from "../src/evaluate/values.js";
import {
  createSsaExecution,
  getNativeScalarOutcome,
  getSsaScalarOutcome,
} from "./helpers/ssa-evaluator.js";

it.each(
  ["===", "!=="].flatMap((operator) =>
    [false, true].flatMap((reverse) =>
      ["3", "-3", "'ready'"].map((literal) => ({ operator, reverse, literal })),
    ),
  ),
)(
  "refines aliases only on the equality side: $operator/$reverse/$literal",
  ({ operator, reverse, literal }) => {
    const first = unknownPrimitiveValue(literal.includes("'") ? "string" : "number", "first");
    const comparison = reverse ? `${literal} ${operator} first` : `first ${operator} ${literal}`;
    const equal = operator === "===";
    const expression = "alias + '!'";
    const body = `const alias=first;if(${comparison}) return ${equal ? expression : "'other'"};return ${equal ? "'other'" : expression};`;
    const execution = createSsaExecution(`function probe(first){${body}}`, { first });
    const result = execution.execute({ fork: (_predicate, paths) => paths[equal ? 0 : 1]() });
    const expected = literal === "'ready'" ? "ready!" : `${Number(literal)}!`;
    expect(result).toEqual(primitiveValue(expected));
  },
);

it.each(["0", "-0"])("does not choose a sign when narrowing equality to %s", (literal) => {
  const first = unknownPrimitiveValue("number", "first");
  const execution = createSsaExecution(
    `function probe(first){if(first===${literal}) return 1/first;return 7;}`,
    { first },
  );
  expect(execution.execute({ fork: (_predicate, paths) => paths[0]() })?.kind).toBe(
    "unknown-primitive",
  );
});

it("does not refine an unrelated input with the same description", () => {
  const first = unknownPrimitiveValue("number", "same");
  const second = unknownPrimitiveValue("number", "same");
  const execution = createSsaExecution(
    "function probe(first,second){if(first===3)return second;return 0;}",
    { first, second },
  );
  expect(execution.execute({ fork: (_predicate, paths) => paths[0]() })).toBe(second);
});

it("does not restore an old definition when refining its alias", () => {
  const first = unknownPrimitiveValue("number", "first");
  const execution = createSsaExecution(
    "function probe(first){const alias=first;first=2;if(alias===3)return first;return 0;}",
    { first },
  );
  expect(execution.execute({ fork: (_predicate, paths) => paths[0]() })).toEqual(primitiveValue(2));
});

const domains: Array<Parameters<typeof unknownPrimitiveValue>[0]> = [
  "number",
  "string",
  "boolean",
  "any",
];
it.each(
  ["===", "!==", "==", "!="].flatMap((operator) =>
    [false, true].flatMap((reverse) => domains.map((domain) => ({ operator, reverse, domain }))),
  ),
)(
  "does not fork an impossible NaN comparison: $operator/$reverse/$domain",
  ({ operator, reverse, domain }) => {
    const first = unknownPrimitiveValue(domain, "first");
    const comparison = reverse ? `(0/0) ${operator} first` : `first ${operator} (0/0)`;
    const body = `if(${comparison}) return true;return false;`;
    const execution = createSsaExecution(`function probe(first){${body}}`, { first });
    const result = getSsaScalarOutcome(execution.execute());
    for (const input of [-1, 0, -0, 1, Infinity, NaN, "ready", false, null, 1n, undefined])
      expect(result).toEqual(getNativeScalarOutcome(body, { first: input }));
  },
);
