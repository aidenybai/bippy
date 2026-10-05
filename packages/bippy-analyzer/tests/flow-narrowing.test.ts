import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { narrowTest } from "../src/evaluate/narrowing.js";
import { getTruthinessPredicate } from "../src/evaluate/predicates.js";
import { getTypeofValue } from "../src/evaluate/value-typeof.js";
import {
  branchValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { parseSourceText } from "../src/parse/parse-source-file.js";
import { andGuard, equalsGuard, type GuardLiteral } from "../src/symbolic/guards.js";
import { parseSymbolicPredicate } from "../src/symbolic/serialization.js";
import type { StaticValue } from "../src/types.js";
import { evaluateCases, getGuardedOutcomes } from "./helpers/differential-evaluator.js";

interface LiteralCase {
  condition: string;
  subject: StaticValue;
  inputs: GuardLiteral[];
  resultExpression?: string;
}

const getNarrowing = (condition: string, value: StaticValue) => {
  const parsed = parseSourceText("/narrowing.ts", condition, "ts");
  expect(parsed.errors).toEqual([]);
  const statement = parsed.program.body[0];
  if (statement?.type !== "ExpressionStatement") throw new Error("Expected a test expression");
  return narrowTest(
    statement.expression,
    (target) => (target.name === "value" && target.key === null ? value : undefined),
    () => null,
    (candidate) => getTypeofValue(candidate, loadHostRealm("node")),
  );
};

const conditions = [
  'typeof value === "string" && typeof value === "string"',
  'typeof value !== "string" || typeof value !== "string"',
  'typeof value === "string" && (typeof value === "string" && typeof value === "string")',
  'typeof value !== "string" || (typeof value !== "string" || typeof value !== "string")',
  'typeof value === "number" && typeof value === "number"',
  'typeof value === "string" && typeof value === "number"',
];

it.each(conditions)(
  "composes type facts without executing the condition: %s",
  async (condition) => {
    const subject = unknownValue("value");
    const input = parseSymbolicPredicate(getTruthinessPredicate(subject)).inputs[0];
    if (!input) throw new Error("Expected a symbolic input");
    const body = `if (${condition}) return "pass"; return "fail";`;
    const [result] = await evaluateCases([{ name: condition, body }], false, "", {
      value: subject,
    });
    for (const nativeValue of ["leaf", "", 3, 0, NaN, true, false, null, undefined, 1n]) {
      const expected: unknown = runInNewContext(
        `(() => { ${body} })()`,
        { value: nativeValue },
        { timeout: 1000 },
      );
      const guard = equalsGuard(
        { input: input.id, path: [], measure: "typeof" },
        typeof nativeValue,
      );
      const actual = getGuardedOutcomes(result, guard);
      expect(actual.length, `${condition}: ${typeof nativeValue}`).toBeGreaterThan(0);
      for (const outcome of actual) expect(outcome).toEqual({ kind: "return", value: expected });
    }
  },
);

const literalCases: LiteralCase[] = [
  {
    condition: 'typeof value === "string" && value === "ready"',
    subject: unknownValue("value"),
    inputs: ["ready", "later", 0, false, null],
    resultExpression: "value.toUpperCase()",
  },
  {
    condition: '!(typeof value !== "string" || value !== "ready")',
    subject: unknownValue("value"),
    inputs: ["ready", "later", 0, false, null],
    resultExpression: "value.toUpperCase()",
  },
  {
    condition: 'typeof value === "number" && value === 3',
    subject: unknownValue("value"),
    inputs: [3, "3", 4, true, null],
    resultExpression: "value + 2",
  },
  {
    condition: 'typeof value === "boolean" && value === true',
    subject: unknownValue("value"),
    inputs: [true, false, 1, "true", null],
    resultExpression: "!value",
  },
  {
    condition: 'value === "leaf"',
    subject: unknownValue("value"),
    inputs: ["leaf", "node", 3, false, null],
  },
  {
    condition: '"leaf" === value',
    subject: unknownValue("value"),
    inputs: ["leaf", "node", 3, false, null],
  },
  { condition: "value === 3", subject: unknownValue("value"), inputs: [3, "3", 4, true, null] },
  { condition: "value === null", subject: unknownValue("value"), inputs: [null, "null", false, 0] },
  {
    condition: "value === true",
    subject: unknownValue("value"),
    inputs: [true, false, 1, "yes", null],
  },
  {
    condition: "value === true",
    subject: unknownPrimitiveValue("number", "value"),
    inputs: [0, 1, 2],
  },
  {
    condition: "value === true",
    subject: unknownPrimitiveValue("boolean", "value"),
    inputs: [true, false],
  },
  {
    condition: "value !== true",
    subject: unknownPrimitiveValue("boolean", "value"),
    inputs: [true, false],
  },
  {
    condition: "value !== false",
    subject: unknownPrimitiveValue("boolean", "value"),
    inputs: [true, false],
  },
];

it.each(literalCases)(
  "refines strict literal equality: $condition",
  async ({ condition, subject, inputs, resultExpression = "value" }) => {
    const input = parseSymbolicPredicate(getTruthinessPredicate(subject)).inputs[0];
    if (!input) throw new Error("Expected a symbolic input");
    const body = `if (${condition}) return ${resultExpression}; return "other";`;
    const [result] = await evaluateCases([{ name: condition, body }], false, "", {
      value: subject,
    });
    for (const nativeValue of inputs) {
      const expected: unknown = runInNewContext(
        `(() => { ${body} })()`,
        { value: nativeValue },
        { timeout: 1000 },
      );
      const guard = andGuard([
        equalsGuard({ input: input.id, path: [], measure: "value" }, nativeValue),
        equalsGuard({ input: input.id, path: [], measure: "typeof" }, typeof nativeValue),
      ]);
      const actual = getGuardedOutcomes(result, guard);
      expect(actual.length, `${condition}: ${String(nativeValue)}`).toBeGreaterThan(0);
      for (const outcome of actual) expect(outcome).toEqual({ kind: "return", value: expected });
    }
  },
);

it("does not infer positive zero from strict equality", () => {
  const value = unknownPrimitiveValue("number", "value");
  expect(getNarrowing("value === 0", value)?.whenTrue).toBe(value);
  expect(getNarrowing("value !== 0", value)?.whenFalse).toBe(value);
});

it("preserves a known negative zero", () => {
  const value = primitiveValue(-0);
  expect(getNarrowing("value === 0", value)?.whenTrue).toBe(value);
});

it("narrows branch alternatives without replacing the opposite side", () => {
  const subject = unknownPrimitiveValue("boolean", "source");
  const predicate = getTruthinessPredicate(subject);
  const value = branchValue(
    [primitiveValue("leaf"), primitiveValue("node")],
    "source",
    null,
    0,
    predicate,
  );
  const narrowing = getNarrowing('value !== "node" && typeof value === "string"', value);
  expect(narrowing?.whenTrue).toEqual(primitiveValue("leaf"));
  expect(narrowing?.whenFalse).toBe(value);
});

it("does not convert loose equality into literal identity", () => {
  const subject = unknownValue("value");
  expect(getNarrowing('value == "3"', subject)).toBeNull();
});
