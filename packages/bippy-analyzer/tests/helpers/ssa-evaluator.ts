import { runInNewContext } from "node:vm";
import { expect } from "vite-plus/test";
import { compileFunction } from "../../src/compiler/compile-function.js";
import { executeSsa, type SsaExecutionHost } from "../../src/evaluate/ssa-execution.js";
import { getErrorWitness } from "../../src/evaluate/errors.js";
import { getTypeofValue } from "../../src/evaluate/value-typeof.js";
import { describeValue, primitiveValue } from "../../src/evaluate/values.js";
import { loadHostRealm } from "../../src/host/host-realm.js";
import { parseSourceText } from "../../src/parse/parse-source-file.js";
import type { StaticPrimitive, StaticValue } from "../../src/types.js";
import { createEvaluationContext } from "./evaluation-context.js";

export interface ScalarOutcome {
  kind: "return" | "throw" | "error" | "unresolved";
  value: unknown;
}

const realm = loadHostRealm("node");

export const parseSsaFunction = (source: string) => {
  const parsed = parseSourceText("/ssa-matrix.ts", source, "ts");
  expect(parsed.errors, source).toEqual([]);
  const declaration = parsed.program.body[0];
  if (declaration?.type !== "FunctionDeclaration")
    throw new Error("Expected a function declaration");
  return declaration;
};

export const createSsaExecution = (
  source: string,
  bindings: Record<string, StaticValue> = {},
  budget = 100000,
) => {
  const node = parseSsaFunction(source);
  const context = createEvaluationContext();
  context.budget.remaining = budget;
  for (const [name, value] of Object.entries(bindings)) context.scope.bindings.set(name, value);
  const execute = (overrides: Partial<SsaExecutionHost> = {}) =>
    executeSsa(
      node,
      context,
      {
        resolve: (value) => value,
        getTypeof: (value) => getTypeofValue(value, realm),
        consumeStep: () => --context.budget.remaining >= 0,
        fork: () => {
          throw new Error("Concrete SSA execution unexpectedly forked");
        },
        distribute: () => {
          throw new Error("Concrete SSA execution unexpectedly distributed");
        },
        ...overrides,
      },
      null,
    );
  return { node, context, execute };
};

export const getNativeScalarOutcome = (
  body: string,
  bindings: Record<string, StaticPrimitive> = {},
): ScalarOutcome =>
  runInNewContext(
    `
  "use strict";
  (() => {
    try { return {kind: "return", value: (function(${Object.keys(bindings).join(", ")}) { ${body} })(...__ssaArguments)}; }
    catch (failure) { return failure instanceof Error ? {kind: "error", value: failure.name} : {kind: "throw", value: failure}; }
  })()
`,
    { __ssaArguments: Object.values(bindings) },
    { timeout: 1000 },
  );

export const getStaticOutcome = (value: StaticValue, isThrown = false): ScalarOutcome => {
  if (!isThrown && value.kind === "unknown" && value.thrown)
    return getStaticOutcome(value.thrown, true);
  if (value.kind === "primitive")
    return { kind: isThrown ? "throw" : "return", value: value.value };
  const witness = isThrown && value.kind === "object" ? getErrorWitness(value) : null;
  if (witness) return { kind: "error", value: witness.name };
  return { kind: "unresolved", value: describeValue(value) };
};

export const getSsaScalarOutcome = (result: StaticValue | null): ScalarOutcome => {
  const outcome = result && getStaticOutcome(result);
  if (outcome && outcome.kind !== "unresolved") return outcome;
  throw new Error(
    `Expected an executed scalar completion, got ${result === null ? "fallback" : result.kind}`,
  );
};

export const checkSsaAgainstNative = (
  body: string,
  bindings: Record<string, StaticPrimitive> = {},
  withoutConstants = false,
): void => {
  const parameters = Object.keys(bindings).join(", ");
  const execution = createSsaExecution(
    `function probe(${parameters}) { ${body} }`,
    Object.fromEntries(
      Object.entries(bindings).map(([name, value]) => [name, primitiveValue(value)]),
    ),
  );
  const compiled = compileFunction(execution.node);
  expect(compiled.status, compiled.reason ?? body).toBe("compiled");
  if (!compiled.function) throw new Error("Missing SSA compilation");
  if (withoutConstants) compiled.function.constants.values.clear();
  const expected = getNativeScalarOutcome(body, bindings);
  const actual = getSsaScalarOutcome(execution.execute());
  expect(actual.kind, body).toBe(expected.kind);
  expect(
    Object.is(actual.value, expected.value),
    `${body}: expected ${String(expected.value)}, received ${String(actual.value)}`,
  ).toBe(true);
};
